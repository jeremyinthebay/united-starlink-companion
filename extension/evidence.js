// Shared, local-only evidence drawers for popup and booking-page metrics.
// Classic script on purpose: `USLEvidence` is shared with popup.js/content.js.
var USLEvidence = (function () {
  "use strict";
  var seq = 0;
  var TRIGGER_TAG = "button";
  var MODEL_SOURCE = "wifiodds.com frozen fleet-source ledger";
  var MISSING_SAMPLE = "sample not provided";

  function text(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  function record(raw) {
    raw = raw || {};
    var sourceDate = text(raw.sourceDate, "source date not provided");
    if (/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) sourceDate = "source date " + sourceDate;
    return {
      kind: text(raw.kind, "metric"),
      subject: text(raw.subject, "WiFi metric"),
      valueText: text(raw.valueText, "not available"),
      measures: text(raw.measures, "No measurement description provided."),
      tier: text(raw.tier, "UNSPECIFIED"),
      source: text(raw.source, "source not provided"),
      sourceDate: sourceDate,
      sample: text(raw.sample, "sample not provided"),
      confidence: text(raw.confidence, "confidence not provided"),
      resolution: text(raw.resolution, "resolution not provided"),
      rowRanking: raw.rowRanking === true,
      decisionRanking: raw.decisionRanking === true,
      rankingCopy: text(raw.rankingCopy,
        raw.rowRanking || raw.decisionRanking ? "This metric can affect ranking." : "This metric does not affect ranking."),
    };
  }

  function modelSample(a) {
    if (a && Number.isFinite(a.known)) {
      return a.known + " known aircraft" +
        (Number.isFinite(a.unresolved) && a.unresolved > 0 ? "; " + a.unresolved + " unresolved" : "");
    }
    return MISSING_SAMPLE;
  }
  function flight(x) {
    x = x || {};
    var hasValue = Number.isFinite(x.probability);
    var conf = text(x.confidence, "confidence not provided");
    var decisionGrade = conf === "high" || conf === "medium";
    return record({
      kind: "flight-nextgen", subject: text(x.fn, "Flight") + " next-gen odds",
      valueText: hasValue ? (conf === "type" ? "~" : "") + x.probability + "%" : "—",
      measures: hasValue ? "Historical chance that this flight number receives a next-gen Starlink aircraft."
        : text(x.stateText, "No per-flight next-gen figure is available."),
      tier: "REPORTED", source: x.source, sourceDate: x.sourceDate,
      sample: Number.isFinite(x.observations) && x.observations > 0 && conf !== "type"
        ? x.observations + " tracked departures" : MISSING_SAMPLE,
      confidence: conf, resolution: conf === "type" ? "Aircraft-type estimate" : "Per flight number",
      rowRanking: hasValue, decisionRanking: hasValue && decisionGrade,
      rankingCopy: !hasValue ? "Does not affect flight-row or winner ranking."
        : decisionGrade ? "May order supported flight rows. It enters the winner gate only with at least two comparable scored flights, an 8-point lead, and no exact-date Guard no."
        : "May order supported flight rows. It cannot name a Best WiFi choice at this confidence.",
    });
  }
  function fleetNextGen(x) {
    x = x || {}; var a = x.airline || {};
    return record({
      kind: "fleet-nextgen", subject: text(a.name, "Airline") + " next-gen fleet share",
      valueText: x.valueText, measures: "Modelled share of the known fleet carrying a currently flying next-gen WiFi system.",
      tier: "MODELLED", source: MODEL_SOURCE, sourceDate: a.asOf,
      sample: modelSample(a), confidence: text(a.fleetStatus, "fleet-level model"),
      resolution: text(a.resolutionLabel, "Airline fleet"), rowRanking: false, decisionRanking: false,
      rankingCopy: "May rank airline summaries by modelled next-gen fleet share. Never ranks a flight row or names a Best WiFi choice.",
    });
  }
  function connectScore(x) {
    x = x || {}; var a = x.airline || {};
    return record({
      kind: "connectscore", subject: text(a.name, "Airline") + " ConnectScore",
      valueText: Number.isFinite(a.score) ? String(a.score) : "—",
      measures: "Streaming-class WiFi quality across the airline's known fleet; it is not a per-flight next-gen probability.",
      tier: "MODELLED", source: MODEL_SOURCE, sourceDate: a.asOf,
      sample: modelSample(a), confidence: text(a.fleetStatus, "fleet-level model"),
      resolution: text(a.resolutionLabel, "Airline fleet"), rowRanking: false, decisionRanking: false,
      rankingCopy: "May rank airline summaries by today's whole-fleet lower bound. Never ranks flight rows or names a Best WiFi choice.",
    });
  }
  function itinerary(x) {
    x = x || {};
    var legs = Array.isArray(x.legs) ? x.legs.filter(function (leg) { return Number.isFinite(leg.obs) && leg.obs > 0; }) : [];
    return record({
      kind: "itinerary-joint", subject: text(x.subject, "All-legs next-gen estimate"),
      valueText: Number.isFinite(x.probability) ? Math.round(x.probability) + "%" : "—",
      measures: "Estimated chance that every leg in this connecting itinerary receives next-gen WiFi.",
      tier: "MODELLED", source: x.source, sourceDate: x.sourceDate,
      sample: legs.length ? legs.map(function (leg) { return text(leg.fn, "leg") + ": " + leg.obs + " tracked departures"; }).join("; ") : MISSING_SAMPLE,
      confidence: text(x.confidence, "confidence not provided"), resolution: "Whole itinerary",
      rowRanking: false, decisionRanking: false,
      rankingCopy: "May order itinerary estimates. Never ranks individual flights or names a Best WiFi choice.",
    });
  }

  function line(parent, label, value) {
    var row = document.createElement("div");
    row.className = "usl-evidence-row";
    var k = document.createElement("span");
    k.className = "usl-evidence-key";
    k.textContent = label;
    var v = document.createElement("span");
    v.className = "usl-evidence-value";
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    parent.appendChild(row);
  }

  function renderDrawer(drawer, trigger, rec) {
    drawer.textContent = "";
    drawer.className = "usl-evidence-drawer";
    drawer.setAttribute("popover", "auto");
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Evidence for " + rec.subject);

    var head = document.createElement("div");
    head.className = "usl-evidence-head";
    var title = document.createElement("div");
    title.className = "usl-evidence-title";
    title.textContent = rec.subject + " · " + rec.valueText;
    var close = document.createElement("button");
    close.type = "button";
    close.className = "usl-evidence-close";
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close evidence drawer");
    close.setAttribute("popovertarget", drawer.id);
    close.setAttribute("popovertargetaction", "hide");
    head.appendChild(title);
    head.appendChild(close);
    drawer.appendChild(head);

    var measure = document.createElement("p");
    measure.className = "usl-evidence-measures";
    measure.textContent = rec.measures;
    drawer.appendChild(measure);
    line(drawer, "Evidence tier", rec.tier);
    line(drawer, "Source", rec.source);
    line(drawer, "Source date", rec.sourceDate);
    line(drawer, "Sample", rec.sample);
    line(drawer, "Confidence", rec.confidence);
    line(drawer, "Resolution", rec.resolution);
    line(drawer, "Flight-row ranking", rec.rowRanking ? "yes" : "no");
    line(drawer, "Decision ranking", rec.decisionRanking ? "yes" : "no");
    var rank = document.createElement("p");
    rank.className = "usl-evidence-ranking";
    rank.textContent = rec.rankingCopy;
    drawer.appendChild(rank);

    trigger.setAttribute("aria-label", "Evidence for " + rec.subject + ": " + rec.valueText);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", drawer.id);
    trigger.setAttribute("popovertarget", drawer.id);
    trigger.dataset.evidenceKind = rec.kind;
    trigger.dataset.evidenceTier = rec.tier;
    trigger.dataset.evidenceSource = rec.source;
    trigger.dataset.evidenceDate = rec.sourceDate;
    trigger.dataset.evidenceSample = rec.sample;
    trigger.dataset.evidenceResolution = rec.resolution;
    trigger.dataset.evidenceRowRanking = String(rec.rowRanking);
    trigger.dataset.evidenceDecisionRanking = String(rec.decisionRanking);
  }

  function upgrade(element, raw) {
    if (!element || !element.parentNode) return element;
    var rec = record(raw);
    var trigger = element;
    if (element.tagName !== "BUTTON") {
      trigger = document.createElement(TRIGGER_TAG);
      trigger.type = "button";
      trigger.className = element.className;
      trigger.textContent = element.textContent;
      if (element.id) trigger.id = element.id;
      for (var i = 0; i < element.attributes.length; i++) {
        var attr = element.attributes[i];
        if (attr.name.indexOf("data-") === 0) trigger.setAttribute(attr.name, attr.value);
      }
      element.replaceWith(trigger);
    }
    if (trigger.tagName === "BUTTON") trigger.type = "button";
    trigger.classList.add("usl-evidence-trigger");
    trigger.removeAttribute("aria-hidden");
    var id = trigger.dataset.uslEvidenceId;
    if (!id) {
      id = "usl-evidence-" + (++seq);
      trigger.dataset.uslEvidenceId = id;
    }
    var drawer = document.getElementById(id);
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.id = id;
      trigger.insertAdjacentElement("afterend", drawer);
    }
    renderDrawer(drawer, trigger, rec);
    if (!trigger.dataset.uslEvidenceBound) {
      trigger.dataset.uslEvidenceBound = "1";
      trigger.addEventListener("click", function (ev) { ev.stopPropagation(); });
      trigger.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
    }
    return trigger;
  }

  return { record: record, flight: flight, fleetNextGen: fleetNextGen,
    connectScore: connectScore, itinerary: itinerary, upgrade: upgrade };
})();
