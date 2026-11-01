/*
 * The public map consumes only the privacy-aggregated listener summary.
 * Text from the response is always added as text, never as markup.
 *
 * ENDPOINT points at the committed status.json snapshot that the
 * snapshot workflow (.github/workflows/snapshot.yml) refreshes every
 * 15 minutes, not at the live API. To read the live aggregate instead,
 * point ENDPOINT at https://<worker>.workers.dev/api/listeners/active
 * (that route sends Access-Control-Allow-Origin: *).
 */
(function () {
  "use strict";

  var ENDPOINT = "status.json";
  var STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
  var POLL_MS = 60000;
  var RETRY_MS = 60000;
  var CITY_MINIMUM = 3;
  var WORLD_CENTER = [12, 26];
  var WORLD_ZOOM = 1.55;
  var reduceMotion = Boolean(
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  var statusLine = document.getElementById("status");
  var statusIndicator = document.getElementById("status-indicator");
  var liveMeta = document.querySelector(".live-meta");
  var updatedLine = document.getElementById("updated");
  var listenerCount = document.getElementById("listener-count");
  var citiesCount = document.getElementById("cities-count");
  var countriesCount = document.getElementById("countries-count");
  var mobileCount = document.getElementById("mobile-count");
  var mobileCityCount = document.getElementById("mobile-city-count");
  var locationTotal = document.getElementById("location-total");
  var citiesTabCount = document.getElementById("cities-tab-count");
  var countriesTabCount = document.getElementById("countries-tab-count");
  var locationList = document.getElementById("location-list");
  var emptyState = document.getElementById("empty-state");
  var emptyTitle = document.getElementById("empty-title");
  var emptyDescription = document.getElementById("empty-description");
  var footerCount = document.getElementById("footer-count");
  var panel = document.getElementById("locations-panel");
  var panelCollapse = document.getElementById("collapse-panel");
  var citiesTab = document.getElementById("cities-tab");
  var countriesTab = document.getElementById("countries-tab");
  var autoZoomButton = document.getElementById("auto-zoom");
  var refreshButton = document.getElementById("refresh");
  var labelsButton = document.getElementById("toggle-labels");
  var privacyPopover = document.getElementById("privacy-popover");
  var privacyTriggers = document.querySelectorAll(".privacy-trigger");
  var closePrivacyButton = document.getElementById("close-privacy");
  var mapElement = document.getElementById("map");

  var regionNames = null;
  try {
    regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  } catch (error) {
    regionNames = null;
  }

  // Approximate country centers let country-only aggregates remain visible without geocoding.
  var COUNTRY_CENTERS = {
    AD: [1.57, 42.55], AE: [54.3, 24.3], AF: [66, 33.9], AG: [-61.8, 17.1], AL: [20, 41.2],
    AM: [45, 40], AO: [17.9, -12.3], AR: [-64, -34], AT: [14.5, 47.5], AU: [134, -25],
    AZ: [47.5, 40.3], BA: [17.8, 44], BB: [-59.5, 13.2], BD: [90.3, 23.7], BE: [4.7, 50.6],
    BF: [-1.6, 12.2], BG: [25.5, 42.7], BH: [50.5, 26], BI: [29.9, -3.4], BJ: [2.3, 9.3],
    BN: [114.7, 4.5], BO: [-64.7, -17], BR: [-52, -10], BS: [-77.4, 25], BT: [90.4, 27.5],
    BW: [24, -22], BY: [28, 53], BZ: [-88.7, 17.2], CA: [-106, 56], CD: [23, -3],
    CF: [20.9, 6.6], CG: [15.2, -0.7], CH: [8.2, 46.8], CI: [-5.5, 7.5], CL: [-71, -30],
    CM: [12.4, 5.7], CN: [103, 35], CO: [-73, 4], CR: [-84, 10], CU: [-77.8, 21.5],
    CV: [-23.9, 15.1], CY: [33, 35], CZ: [15.5, 49.8], DE: [10.5, 51], DJ: [42.6, 11.8],
    DK: [9.5, 56], DO: [-70, 19], DZ: [2.6, 28], EC: [-78.2, -1.4], EE: [25.5, 58.7],
    EG: [30, 27], ER: [39, 15], ES: [-4, 40], ET: [40, 9], FI: [26, 64], FJ: [178, -17.8],
    FR: [2, 46], GA: [11.6, -0.6], GB: [-2, 54], GE: [43.5, 42], GH: [-1.2, 7.9],
    GM: [-16.6, 13.4], GN: [-10, 10.5], GQ: [10.3, 1.6], GR: [22, 39], GT: [-90.2, 15.5],
    GW: [-15, 12], GY: [-58.9, 5], HK: [114.2, 22.3], HN: [-86.5, 15], HR: [16, 45.2],
    HT: [-72.3, 19], HU: [19, 47], ID: [118, -2], IE: [-8, 53], IL: [35, 31.3],
    IN: [79, 22], IQ: [44, 33], IR: [53, 32], IS: [-19, 65], IT: [12.8, 42.8],
    JM: [-77.3, 18.1], JO: [36, 31], JP: [138, 37], KE: [38, 0.5], KG: [74.5, 41.2],
    KH: [104.9, 12.7], KP: [127, 40], KR: [128, 36], KW: [47.5, 29.3], KZ: [67, 48],
    LA: [103, 19], LB: [35.8, 33.9], LK: [80.7, 7.9], LR: [-9.3, 6.5], LT: [24, 55.2],
    LU: [6.1, 49.8], LV: [24.6, 56.9], LY: [17, 27], MA: [-6, 32], MD: [28.5, 47],
    ME: [19.3, 42.7], MG: [46.7, -19], MK: [21.7, 41.6], ML: [-3.9, 17], MM: [96, 22],
    MN: [103, 46], MR: [-10.4, 20], MT: [14.4, 35.9], MU: [57.5, -20.3], MV: [73.2, 3.2],
    MW: [34, -13.5], MX: [-102, 23], MY: [102.5, 4.2], MZ: [35.5, -18], NA: [17, -22],
    NE: [9.4, 17], NG: [8, 9], NI: [-85, 13], NL: [5.5, 52], NO: [10, 62], NP: [84, 28],
    NZ: [172, -41], OM: [57, 21], PA: [-80, 9], PE: [-75, -9], PH: [122, 12], PK: [69, 30],
    PL: [19, 52], PT: [-8, 39.5], PY: [-58.5, -23], QA: [51.2, 25.3], RO: [25, 46],
    RS: [20.8, 44], RU: [90, 60], RW: [29.9, -2], SA: [45, 24], SD: [30, 13], SE: [16, 62],
    SG: [103.8, 1.3], SI: [14.9, 46], SK: [19.5, 48.7], SL: [-11.7, 8.5], SN: [-14.5, 14.4],
    SO: [46, 6], SS: [31, 7], SV: [-89, 13.7], SY: [38, 35], TD: [19, 15], TG: [1, 8],
    TH: [101, 15], TJ: [71, 39], TM: [59, 39], TN: [9, 34], TR: [35, 39], TT: [-61.2, 10.7],
    TW: [121, 23.7], TZ: [35, -6], UA: [32, 49], UG: [32, 1.4], US: [-98, 39],
    UY: [-56, -33], UZ: [64, 41], VE: [-66, 8], VN: [108, 16], YE: [48, 15], ZA: [24, -29],
    ZM: [28, -14], ZW: [29.8, -19]
  };

  var map = null;
  var mapLoaded = false;
  var mapLocations = [];
  var activeMarkers = [];
  var activePopup = null;
  var renderedLocationSignature = null;
  var lastCameraSignature = null;
  var pendingMapTarget = null;
  var activeTab = "cities";
  var autoZoom = true;
  var labelsVisible = true;
  var latestData = { activeListeners: 0, countries: [], cities: [], updatedAt: null };
  var lastUpdatedAt = null;
  var timer = null;
  var relativeTimer = null;
  var requestController = null;
  var requestSerial = 0;
  var activePrivacyTrigger = null;

  function countryCode(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
  }

  function countryName(code) {
    var normalized = countryCode(code);
    if (!/^[A-Z]{2}$/.test(normalized)) {
      return "Unknown";
    }
    try {
      return (regionNames && regionNames.of(normalized)) || normalized;
    } catch (error) {
      return normalized;
    }
  }

  function listenerCountValue(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function listenerLabel(count) {
    return count === 1 ? "1 listener" : count.toLocaleString() + " listeners";
  }

  function isCoordinate(longitude, latitude) {
    return (
      typeof longitude === "number" &&
      typeof latitude === "number" &&
      isFinite(longitude) &&
      isFinite(latitude) &&
      Math.abs(longitude) <= 180 &&
      Math.abs(latitude) <= 90
    );
  }

  function normalizedCities(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .filter(function (entry) {
        return (
          entry &&
          typeof entry.city === "string" &&
          entry.city.trim() &&
          typeof entry.country === "string" &&
          listenerCountValue(entry.count) >= CITY_MINIMUM &&
          isCoordinate(entry.longitude, entry.latitude)
        );
      })
      .map(function (entry) {
        return {
          kind: "city",
          city: entry.city.trim(),
          country: countryCode(entry.country),
          count: listenerCountValue(entry.count),
          longitude: entry.longitude,
          latitude: entry.latitude
        };
      });
  }

  function normalizedCountries(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .filter(function (entry) {
        return entry && typeof entry.country === "string" && listenerCountValue(entry.count) > 0;
      })
      .map(function (entry) {
        return {
          country: countryCode(entry.country),
          count: listenerCountValue(entry.count)
        };
      });
  }

  function sourceCountryPoint(code) {
    if (!map || !mapLoaded || !map.querySourceFeatures) {
      return null;
    }
    var style;
    try {
      style = map.getStyle();
    } catch (error) {
      return null;
    }
    var layers = style && Array.isArray(style.layers) ? style.layers : [];
    var sources = style && style.sources ? style.sources : {};
    var targetName = countryName(code).toLowerCase();
    var checked = Object.create(null);
    for (var i = 0; i < layers.length; i += 1) {
      var layer = layers[i];
      var sourceLayer = layer && layer["source-layer"];
      if (!layer || layer.type !== "symbol" || !layer.source || !sourceLayer || checked[layer.source + ":" + sourceLayer]) {
        continue;
      }
      if (!sources[layer.source] || sources[layer.source].type !== "vector") {
        continue;
      }
      checked[layer.source + ":" + sourceLayer] = true;
      var features = [];
      try {
        features = map.querySourceFeatures(layer.source, { sourceLayer: sourceLayer }) || [];
      } catch (error) {
        continue;
      }
      for (var j = 0; j < features.length; j += 1) {
        var feature = features[j];
        var properties = feature && feature.properties ? feature.properties : {};
        var candidate = countryCode(
          properties.iso_a2 ||
            properties.ISO_A2 ||
            properties.iso3166_1 ||
            properties["iso_3166_1"] ||
            properties.country_code ||
            properties.country
        );
        var name = String(properties.name_en || properties.name || "").toLowerCase();
        var countryClass = properties.class === "country" || properties.place === "country";
        if (
          feature.geometry &&
          feature.geometry.type === "Point" &&
          Array.isArray(feature.geometry.coordinates) &&
          ((candidate === code && countryClass) || (countryClass && name === targetName))
        ) {
          var coordinates = feature.geometry.coordinates;
          if (isCoordinate(coordinates[0], coordinates[1])) {
            return [coordinates[0], coordinates[1]];
          }
        }
      }
    }
    return null;
  }

  function countryCenterFor(code) {
    var normalized = countryCode(code);
    var fromMap = sourceCountryPoint(normalized);
    if (fromMap) {
      return fromMap;
    }
    return COUNTRY_CENTERS[normalized] || null;
  }

  function locationsForData(data, cities, countries) {
    var locations = cities.slice();
    var countriesWithCities = Object.create(null);
    cities.forEach(function (city) {
      countriesWithCities[city.country] = true;
    });
    countries.forEach(function (country) {
      if (countriesWithCities[country.country]) {
        return;
      }
      var center = countryCenterFor(country.country);
      if (!center) {
        return;
      }
      locations.push({
        kind: "country",
        city: "",
        country: country.country,
        count: country.count,
        longitude: center[0],
        latitude: center[1]
      });
    });
    return locations;
  }

  function signatureForLocations(locations, includeCounts) {
    return locations
      .map(function (location) {
        var parts = [
          location.kind,
          location.city,
          location.country,
          location.longitude,
          location.latitude
        ];
        if (includeCounts) {
          parts.push(location.count);
        }
        return parts.join("|");
      })
      .sort()
      .join(";");
  }

  function emptyCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function featureCollection(locations) {
    return {
      type: "FeatureCollection",
      features: locations.map(function (location) {
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [location.longitude, location.latitude]
          },
          properties: {
            kind: location.kind,
            city: location.city,
            country: location.country,
            count: location.count
          }
        };
      })
    };
  }

  function markerSize(count) {
    return Math.min(34, Math.round(18 + Math.sqrt(count) * 2.1));
  }

  function createMarker(location) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "presence-marker presence-marker--" + location.kind;
    button.style.setProperty("--marker-size", markerSize(location.count) + "px");
    button.style.setProperty("--marker-core", Math.min(15, 7 + Math.sqrt(location.count) * 0.75) + "px");
    var name = location.kind === "city" ? location.city : countryName(location.country);
    button.setAttribute(
      "aria-label",
      name + ", " + countryName(location.country) + ", " + listenerLabel(location.count)
    );
    button.title = name + " · " + listenerLabel(location.count);

    var glow = document.createElement("span");
    glow.className = "marker-glow";
    glow.setAttribute("aria-hidden", "true");
    var core = document.createElement("span");
    core.className = "marker-core";
    core.setAttribute("aria-hidden", "true");
    button.appendChild(glow);
    button.appendChild(core);
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      flyToLocation(location, true);
    });

    var marker = new window.maplibregl.Marker({ element: button, anchor: "center" })
      .setLngLat([location.longitude, location.latitude])
      .addTo(map);
    activeMarkers.push(marker);
  }

  function clearMarkers() {
    activeMarkers.forEach(function (marker) {
      marker.remove();
    });
    activeMarkers = [];
  }

  function updateMapLocations(data, force) {
    var cities = normalizedCities(data.cities);
    var countries = normalizedCountries(data.countries);
    var locations = locationsForData(data, cities, countries);
    mapLocations = locations;
    if (!mapLoaded) {
      return locations;
    }
    var nextSignature = signatureForLocations(locations, true);
    if (!force && nextSignature === renderedLocationSignature) {
      return locations;
    }
    renderedLocationSignature = nextSignature;
    var source = map.getSource("presence-locations");
    if (source) {
      source.setData(featureCollection(locations));
    }
    clearMarkers();
    locations.forEach(createMarker);
    return locations;
  }

  function addPresenceLayers() {
    map.addSource("presence-locations", {
      type: "geojson",
      data: emptyCollection()
    });
    var style = map.getStyle();
    var layers = style && Array.isArray(style.layers) ? style.layers : [];
    var firstSymbol = null;
    for (var i = 0; i < layers.length; i += 1) {
      if (layers[i].type === "symbol") {
        firstSymbol = layers[i].id;
        break;
      }
    }
    var beforeId = firstSymbol || undefined;
    map.addLayer(
      {
        id: "presence-heat",
        type: "heatmap",
        source: "presence-locations",
        maxzoom: 8,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 1, 0.28, 30, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.55, 7, 1.15],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 18, 7, 34],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.36, 7, 0.25],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(87, 202, 132, 0)",
            0.22,
            "rgba(87, 202, 132, 0.12)",
            0.55,
            "rgba(102, 222, 145, 0.3)",
            1,
            "rgba(176, 255, 192, 0.64)"
          ]
        }
      },
      beforeId
    );
    map.addLayer(
      {
        id: "presence-glow",
        type: "circle",
        source: "presence-locations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 9, 5, 15, 30, 24, 100, 33],
          "circle-color": [
            "match",
            ["get", "kind"],
            "country",
            "#8dd5a4",
            "#75e49b"
          ],
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.24, 7, 0.31],
          "circle-blur": 0.82
        }
      },
      beforeId
    );
  }

  function applyLabelVisibility() {
    if (!map || !mapLoaded) {
      return;
    }
    var style = map.getStyle();
    var layers = style && Array.isArray(style.layers) ? style.layers : [];
    layers.forEach(function (layer) {
      if (layer.type === "symbol") {
        map.setLayoutProperty(layer.id, "visibility", labelsVisible ? "visible" : "none");
      }
    });
  }

  function onMapLoad() {
    if (mapLoaded) {
      return;
    }
    mapLoaded = true;
    addPresenceLayers();
    applyLabelVisibility();
    var locations = updateMapLocations(latestData, true);
    if (pendingMapTarget) {
      var target = pendingMapTarget;
      pendingMapTarget = null;
      flyToLocation(target, true);
    } else if (autoZoom && locations.length) {
      fitToListeners(false);
    }
  }

  function mapPadding() {
    var isMobile = window.innerWidth <= 700;
    var collapsed = panel.classList.contains("is-collapsed");
    if (isMobile) {
      return {
        top: 84,
        right: 55,
        bottom: collapsed ? 88 : Math.min(320, panel.getBoundingClientRect().height + 30),
        left: 22
      };
    }
    return {
      top: 96,
      right: collapsed ? 90 : 370,
      bottom: collapsed ? 80 : 305,
      left: 270
    };
  }

  function transitionOptions(duration) {
    return reduceMotion ? 0 : duration;
  }

  function flyToLocation(location, showPopup) {
    if (!map || !location) {
      return;
    }
    if (!mapLoaded) {
      pendingMapTarget = location;
      return;
    }
    var center = [location.longitude, location.latitude];
    var targetZoom = location.kind === "city" ? 5.3 : 3.2;
    targetZoom = Math.min(8, Math.max(targetZoom, Math.min(map.getZoom(), 7.5)));
    if (reduceMotion) {
      map.jumpTo({ center: center, zoom: targetZoom });
    } else {
      map.flyTo({
        center: center,
        zoom: targetZoom,
        duration: 1150,
        curve: 1.35,
        essential: false
      });
    }
    if (showPopup && window.maplibregl && window.maplibregl.Popup) {
      if (activePopup) {
        activePopup.remove();
      }
      var popupContent = document.createElement("div");
      popupContent.className = "popup-content";
      var title = document.createElement("strong");
      title.className = "popup-title";
      title.textContent = location.kind === "city" ? location.city : countryName(location.country);
      var detail = document.createElement("span");
      detail.className = "popup-detail";
      detail.textContent =
        countryName(location.country) + " · " + listenerLabel(location.count);
      popupContent.appendChild(title);
      popupContent.appendChild(detail);
      activePopup = new window.maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 14,
        maxWidth: "240px"
      })
        .setLngLat(center)
        .setDOMContent(popupContent)
        .addTo(map);
    }
  }

  function fitToListeners(animate) {
    if (!map) {
      return;
    }
    if (!mapLoaded) {
      return;
    }
    if (!mapLocations.length) {
      resetWorldView(animate);
      return;
    }
    if (mapLocations.length === 1) {
      var single = mapLocations[0];
      var zoom = single.kind === "city" ? 4.8 : 2.6;
      if (reduceMotion || !animate) {
        map.jumpTo({ center: [single.longitude, single.latitude], zoom: zoom });
      } else {
        map.flyTo({
          center: [single.longitude, single.latitude],
          zoom: zoom,
          duration: 1250,
          essential: false
        });
      }
      return;
    }
    var west = 180;
    var south = 90;
    var east = -180;
    var north = -90;
    mapLocations.forEach(function (location) {
      west = Math.min(west, location.longitude);
      south = Math.min(south, location.latitude);
      east = Math.max(east, location.longitude);
      north = Math.max(north, location.latitude);
    });
    var sameLongitude = Math.abs(east - west) < 0.1;
    var sameLatitude = Math.abs(north - south) < 0.1;
    if (sameLongitude) {
      west -= 0.2;
      east += 0.2;
    }
    if (sameLatitude) {
      south -= 0.2;
      north += 0.2;
    }
    map.fitBounds(
      [
        [west, south],
        [east, north]
      ],
      {
        padding: mapPadding(),
        maxZoom: 5.4,
        duration: reduceMotion || !animate ? 0 : 1350,
        essential: false
      }
    );
  }

  function resetWorldView(animate) {
    if (!map) {
      return;
    }
    if (reduceMotion || !animate) {
      map.jumpTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM });
    } else {
      map.flyTo({
        center: WORLD_CENTER,
        zoom: WORLD_ZOOM,
        duration: 1050,
        essential: false
      });
    }
  }

  function validCityRows(entries) {
    return normalizedCities(entries);
  }

  function locationForCountry(country, cities) {
    var city = cities.find(function (entry) {
      return entry.country === country.country;
    });
    if (city) {
      return city;
    }
    var center = countryCenterFor(country.country);
    if (!center) {
      return null;
    }
    return {
      kind: "country",
      city: "",
      country: country.country,
      count: country.count,
      longitude: center[0],
      latitude: center[1]
    };
  }

  function createRowIcon(isCountry) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (isCountry) {
      var globe = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      globe.setAttribute("cx", "12");
      globe.setAttribute("cy", "12");
      globe.setAttribute("r", "8.5");
      svg.appendChild(globe);
      var longitude = document.createElementNS("http://www.w3.org/2000/svg", "path");
      longitude.setAttribute("d", "M3.5 12h17M12 3.5c2.2 2.4 3.2 5.2 3.2 8.5s-1 6.1-3.2 8.5c-2.2-2.4-3.2-5.2-3.2-8.5s1-6.1 3.2-8.5Z");
      svg.appendChild(longitude);
    } else {
      var pin = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pin.setAttribute("d", "M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z");
      svg.appendChild(pin);
      var center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      center.setAttribute("cx", "12");
      center.setAttribute("cy", "10");
      center.setAttribute("r", "2.2");
      svg.appendChild(center);
    }
    return svg;
  }

  function createLocationRow(location, isCountry) {
    var item = document.createElement("li");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "location-row";
    var name = isCountry ? (location.other ? "Other regions" : countryName(location.country)) : location.city;
    var detailText = isCountry
      ? location.other
        ? "Countries with fewer than 3 listeners"
        : "Country-wide estimate"
      : countryName(location.country);
    button.setAttribute(
      "aria-label",
      name + ", " + listenerLabel(location.count) + (isCountry ? ", country estimate" : "")
    );

    var pin = document.createElement("span");
    pin.className = "row-pin";
    pin.appendChild(createRowIcon(isCountry));
    var copy = document.createElement("span");
    copy.className = "row-copy";
    var title = document.createElement("span");
    title.className = "row-name";
    title.textContent = name;
    var detail = document.createElement("span");
    detail.className = "row-detail";
    detail.textContent = detailText;
    copy.appendChild(title);
    copy.appendChild(detail);
    var count = document.createElement("span");
    count.className = "row-count";
    count.textContent = String(location.count);
    button.appendChild(pin);
    button.appendChild(copy);
    button.appendChild(count);
    button.addEventListener("click", function () {
      var target = isCountry ? locationForCountry(location, validCityRows(latestData.cities)) : location;
      if (target) {
        flyToLocation(target, true);
      }
    });
    item.appendChild(button);
    return item;
  }

  function updateEmptyState(activeListeners, selectedCount, selectedTab) {
    var noListeners = activeListeners === 0;
    if (noListeners) {
      emptyTitle.textContent = "No listeners online right now";
      emptyDescription.textContent = "Waiting for listeners to connect";
    } else if (selectedTab === "cities") {
      emptyTitle.textContent = "No city locations yet";
      emptyDescription.textContent = "A city appears only with at least 3 listeners";
    } else {
      emptyTitle.textContent = "Country locations are unavailable";
      emptyDescription.textContent = "Waiting for country totals to update";
    }
    locationList.hidden = selectedCount === 0;
    emptyState.hidden = selectedCount > 0;
  }

  function updatePanel(data, cities, countries, markerLocations) {
    var activeListeners = listenerCountValue(data.activeListeners);
    var rows = activeTab === "cities" ? cities : countries;
    locationList.textContent = "";
    rows.forEach(function (entry) {
      var rowLocation =
        activeTab === "cities"
          ? entry
          : {
              kind: "country",
              country: entry.country,
              count: entry.count
            };
      locationList.appendChild(createLocationRow(rowLocation, activeTab === "countries"));
    });
    // Countries below the publication minimum are reported only as a sum; the row is not geocoded and
    // clicking it is a no-op.
    var otherCount = activeTab === "countries" ? listenerCountValue(data.otherCountryListeners) : 0;
    if (otherCount > 0) {
      locationList.appendChild(
        createLocationRow({ kind: "country", country: "", count: otherCount, other: true }, true)
      );
    }
    citiesTab.setAttribute("aria-selected", activeTab === "cities" ? "true" : "false");
    countriesTab.setAttribute("aria-selected", activeTab === "countries" ? "true" : "false");
    citiesTab.tabIndex = activeTab === "cities" ? 0 : -1;
    countriesTab.tabIndex = activeTab === "countries" ? 0 : -1;
    citiesTab.classList.toggle("is-selected", activeTab === "cities");
    countriesTab.classList.toggle("is-selected", activeTab === "countries");
    locationList.setAttribute("aria-labelledby", activeTab === "cities" ? "cities-tab" : "countries-tab");
    locationList.setAttribute("aria-label", activeTab === "cities" ? "Listener cities" : "Listener countries");
    updateEmptyState(activeListeners, rows.length + (otherCount > 0 ? 1 : 0), activeTab);
    locationTotal.textContent = "(" + markerLocations.length + ")";
    citiesTabCount.textContent = "(" + cities.length + ")";
    countriesTabCount.textContent = "(" + countries.length + ")";
    footerCount.textContent = activeListeners.toLocaleString() + " listening";
  }

  function bumpText(element, value) {
    var text = String(value);
    if (element.textContent === text) {
      return;
    }
    element.textContent = text;
    element.classList.remove("count-bump");
    if (!reduceMotion) {
      window.requestAnimationFrame(function () {
        element.classList.add("count-bump");
        window.setTimeout(function () {
          element.classList.remove("count-bump");
        }, 360);
      });
    }
  }

  function relativeTime(iso) {
    var date = iso ? new Date(iso) : null;
    if (!date || isNaN(date.getTime())) {
      return "just now";
    }
    var seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 10) {
      return "just now";
    }
    if (seconds < 60) {
      return seconds + "s ago";
    }
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return minutes + "m ago";
    }
    var hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return hours + "h ago";
    }
    return Math.floor(hours / 24) + "d ago";
  }

  function setConnectionStatus(online) {
    statusLine.textContent = online ? "Live" : "Offline";
    liveMeta.classList.toggle("is-offline", !online);
    statusIndicator.setAttribute("aria-label", online ? "Online" : "Offline");
  }

  function updateStatusTime() {
    updatedLine.textContent = "Updated " + relativeTime(lastUpdatedAt);
  }

  function startRelativeClock() {
    if (relativeTimer !== null || document.visibilityState === "hidden") {
      return;
    }
    relativeTimer = window.setInterval(updateStatusTime, 15000);
  }

  function stopRelativeClock() {
    if (relativeTimer !== null) {
      window.clearInterval(relativeTimer);
      relativeTimer = null;
    }
  }

  function render(data) {
    var activeListeners = listenerCountValue(data.activeListeners);
    var cities = normalizedCities(data.cities);
    var countries = normalizedCountries(data.countries);
    var previousCameraSignature = lastCameraSignature;
    latestData = {
      activeListeners: activeListeners,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      countries: countries,
      cities: cities
    };
    lastUpdatedAt =
      latestData.updatedAt && !isNaN(new Date(latestData.updatedAt).getTime())
        ? latestData.updatedAt
        : new Date().toISOString();

    bumpText(listenerCount, activeListeners.toLocaleString());
    bumpText(citiesCount, String(cities.length));
    bumpText(countriesCount, String(countries.length));
    bumpText(mobileCount, activeListeners.toLocaleString());
    bumpText(mobileCityCount, String(cities.length));
    document.querySelector(".stats-caption").textContent =
      activeListeners === 1 ? "person listening right now" : "people listening right now";
    var markerLocations = updateMapLocations(latestData, false);
    updatePanel(latestData, cities, countries, markerLocations);
    var cameraSignature = signatureForLocations(markerLocations, false);
    lastCameraSignature = cameraSignature;
    if (mapLoaded && autoZoom && cameraSignature !== previousCameraSignature && markerLocations.length) {
      fitToListeners(true);
    } else if (mapLoaded && autoZoom && previousCameraSignature && !markerLocations.length) {
      resetWorldView(true);
    }
    updateStatusTime();
  }

  function schedule(delay) {
    if (document.visibilityState === "hidden") {
      return;
    }
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(function () {
      timer = null;
      refresh();
    }, delay);
  }

  function refresh() {
    if (document.visibilityState === "hidden") {
      return;
    }
    if (requestController) {
      requestController.abort();
    }
    var serial = ++requestSerial;
    requestController = typeof window.AbortController === "function" ? new window.AbortController() : null;
    if (refreshButton) {
      refreshButton.classList.add("is-loading");
    }
    var options = {
      headers: { accept: "application/json" },
      cache: "no-store"
    };
    if (requestController) {
      options.signal = requestController.signal;
    }
    fetch(ENDPOINT, options)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (serial !== requestSerial || document.visibilityState === "hidden") {
          return;
        }
        if (!data || typeof data !== "object") {
          throw new Error("Invalid listener response");
        }
        render(data);
        setConnectionStatus(true);
        schedule(POLL_MS);
      })
      .catch(function (error) {
        if (
          serial !== requestSerial ||
          document.visibilityState === "hidden" ||
          (error && error.name === "AbortError")
        ) {
          return;
        }
        setConnectionStatus(false);
        updateStatusTime();
        schedule(RETRY_MS);
      })
      .then(function () {
        if (serial === requestSerial && refreshButton) {
          refreshButton.classList.remove("is-loading");
        }
        if (serial === requestSerial) {
          requestController = null;
        }
      });
  }

  function showTab(tab) {
    activeTab = tab;
    updatePanel(
      latestData,
      normalizedCities(latestData.cities),
      normalizedCountries(latestData.countries),
      mapLocations
    );
  }

  function togglePanel() {
    var collapsed = panel.classList.toggle("is-collapsed");
    panelCollapse.setAttribute("aria-expanded", collapsed ? "false" : "true");
    panelCollapse.setAttribute("aria-label", collapsed ? "Expand locations panel" : "Collapse locations panel");
    panelCollapse.title = collapsed ? "Expand panel" : "Collapse panel";
  }

  function setLabels(visible) {
    labelsVisible = visible;
    labelsButton.classList.toggle("is-active", visible);
    labelsButton.setAttribute("aria-pressed", visible ? "true" : "false");
    labelsButton.setAttribute("aria-label", visible ? "Hide map labels" : "Show map labels");
    labelsButton.title = visible ? "Labels on" : "Labels off";
    if (mapLoaded) {
      applyLabelVisibility();
    }
  }

  function closePrivacy(returnFocus) {
    if (privacyPopover.hidden) {
      return;
    }
    privacyPopover.hidden = true;
    privacyTriggers.forEach(function (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    });
    if (returnFocus && activePrivacyTrigger) {
      activePrivacyTrigger.focus();
    }
    activePrivacyTrigger = null;
  }

  function openPrivacy(trigger) {
    if (!privacyPopover.hidden && activePrivacyTrigger === trigger) {
      closePrivacy(false);
      return;
    }
    privacyTriggers.forEach(function (button) {
      button.setAttribute("aria-expanded", "false");
    });
    activePrivacyTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    privacyPopover.hidden = false;
    positionPrivacyPopover(trigger);
  }

  function positionPrivacyPopover(trigger) {
    if (!trigger || privacyPopover.hidden) {
      return;
    }
    privacyPopover.style.visibility = "hidden";
    window.requestAnimationFrame(function () {
      if (privacyPopover.hidden || activePrivacyTrigger !== trigger) {
        return;
      }
      var rect = trigger.getBoundingClientRect();
      var popoverRect = privacyPopover.getBoundingClientRect();
      var padding = 12;
      var left = rect.left + rect.width / 2 - popoverRect.width / 2;
      left = Math.max(padding, Math.min(left, window.innerWidth - popoverRect.width - padding));
      var top = rect.bottom + 8;
      if (top + popoverRect.height > window.innerHeight - padding) {
        top = rect.top - popoverRect.height - 8;
      }
      top = Math.max(padding, Math.min(top, window.innerHeight - popoverRect.height - padding));
      privacyPopover.style.left = Math.round(left) + "px";
      privacyPopover.style.top = Math.round(top) + "px";
      privacyPopover.style.visibility = "visible";
    });
  }

  function initPrivacy() {
    privacyTriggers.forEach(function (trigger) {
      trigger.addEventListener("click", function (event) {
        event.stopPropagation();
        openPrivacy(trigger);
      });
    });
    closePrivacyButton.addEventListener("click", function () {
      closePrivacy(true);
    });
    document.addEventListener("click", function (event) {
      if (
        !privacyPopover.hidden &&
        !privacyPopover.contains(event.target) &&
        !event.target.closest(".privacy-trigger")
      ) {
        closePrivacy(false);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !privacyPopover.hidden) {
        closePrivacy(true);
      }
    });
  }

  function initMap() {
    if (!window.maplibregl || !mapElement) {
      if (mapElement) {
        mapElement.classList.add("map-unavailable");
        var message = document.createElement("div");
        message.className = "map-fallback";
        message.textContent = "The map could not load. Live listener totals are still available.";
        document.getElementById("map-stage").appendChild(message);
      }
      return;
    }
    map = new window.maplibregl.Map({
      container: mapElement,
      style: STYLE_URL,
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: 1,
      maxZoom: 13,
      maxPitch: 0,
      pitch: 0,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false
    });
    map.addControl(
      new window.maplibregl.AttributionControl({
        compact: true,
        customAttribution: "© OpenFreeMap · © OpenStreetMap contributors"
      }),
      "bottom-left"
    );
    map.on("load", onMapLoad);
    map.on("style.load", applyLabelVisibility);
  }

  function initControls() {
    autoZoomButton.addEventListener("click", function () {
      autoZoom = !autoZoom;
      autoZoomButton.classList.toggle("is-active", autoZoom);
      autoZoomButton.setAttribute("aria-pressed", autoZoom ? "true" : "false");
      if (autoZoom) {
        fitToListeners(true);
      }
    });
    refreshButton.addEventListener("click", function () {
      schedule(0);
    });
    document.getElementById("zoom-in").addEventListener("click", function () {
      if (map) {
        map.zoomIn({ duration: transitionOptions(300) });
      }
    });
    document.getElementById("zoom-out").addEventListener("click", function () {
      if (map) {
        map.zoomOut({ duration: transitionOptions(300) });
      }
    });
    document.getElementById("fit-locations").addEventListener("click", function () {
      fitToListeners(true);
    });
    document.getElementById("world-view").addEventListener("click", function () {
      resetWorldView(true);
    });
    labelsButton.addEventListener("click", function () {
      setLabels(!labelsVisible);
    });
    citiesTab.addEventListener("click", function () {
      showTab("cities");
    });
    countriesTab.addEventListener("click", function () {
      showTab("countries");
    });
    document.querySelector(".panel-tabs").addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      var nextTab = activeTab === "cities" ? "countries" : "cities";
      showTab(nextTab);
      (nextTab === "cities" ? citiesTab : countriesTab).focus();
    });
    panelCollapse.addEventListener("click", togglePanel);

    var grabber = document.querySelector(".sheet-grabber");
    var dragStart = null;
    grabber.addEventListener("pointerdown", function (event) {
      dragStart = event.clientY;
      if (grabber.setPointerCapture) {
        grabber.setPointerCapture(event.pointerId);
      }
    });
    grabber.addEventListener("pointerup", function (event) {
      if (dragStart === null) {
        return;
      }
      var delta = event.clientY - dragStart;
      dragStart = null;
      if (delta > 32 && !panel.classList.contains("is-collapsed")) {
        togglePanel();
      } else if (delta < -32 && panel.classList.contains("is-collapsed")) {
        togglePanel();
      }
    });
    grabber.addEventListener("pointercancel", function () {
      dragStart = null;
    });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      stopRelativeClock();
      requestSerial += 1;
      if (requestController) {
        requestController.abort();
        requestController = null;
      }
      refreshButton.classList.remove("is-loading");
      return;
    }
    startRelativeClock();
    schedule(0);
  }

  initPrivacy();
  initControls();
  initMap();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("resize", function () {
    if (!privacyPopover.hidden && activePrivacyTrigger) {
      positionPrivacyPopover(activePrivacyTrigger);
    }
  });
  render(latestData);
  startRelativeClock();
  refresh();
})();
