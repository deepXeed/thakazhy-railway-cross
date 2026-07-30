import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, remove, onValue, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ---------- PASTE YOUR CONFIG HERE ----------
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDcGxh55iDPw2ACVbH5FX1plB9D4Sxp4qY",
  authDomain: "thakazhy-cross.firebaseapp.com",
  databaseURL: "https://thakazhy-cross-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "thakazhy-cross",
  storageBucket: "thakazhy-cross.firebasestorage.app",
  messagingSenderId: "344595932466",
  appId: "1:344595932466:web:93dc4da68a3ab50ddc632b",
  measurementId: "G-EQ2776LTJJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const reportsRef = ref(db, 'reports');

// ---------- App Constants & State ----------
const MAX_REPORTS = 12;

// Thakazhy Cross center point (near railway station)
const CROSSING_LAT = 9.374301;
const CROSSING_LNG = 76.407578;
const MAX_DISTANCE_METERS = 150;

const els = {
  statusCard: document.getElementById("status-card"),
  statusIcon: document.getElementById("status-icon"),
  statusLabel: document.getElementById("status-label"),
  statusDetail: document.getElementById("status-detail"),
  reportList: document.getElementById("report-list"),
  reportCount: document.getElementById("report-count"),
  reportTally: document.getElementById("report-tally"),
  emptyState: document.getElementById("empty-state"),
  lastUpdated: document.getElementById("last-updated"),
  btnOpen: document.getElementById("btn-open"),
  btnClosed: document.getElementById("btn-closed"),
  reportFormBlock: document.getElementById("report-form-block"),
  myReportBlock: document.getElementById("my-report-block"),
  myReportIcon: document.getElementById("my-report-icon"),
  myReportText: document.getElementById("my-report-text"),
  btnCancel: document.getElementById("btn-cancel"),
};

let userAllowedToReport = false; // will be set after location check
let liveReports = []; // Replaces localStorage

// ---------- Device identity & "my report" tracking ----------
// One device = one active report at a time. We remember the device with a
// random ID in localStorage, and remember which Firebase report (by push key)
// belongs to this device so it can be cancelled/corrected later.
const DEVICE_ID_KEY = "thakazhy_device_id";
const MY_REPORT_KEY = "thakazhy_my_report";

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
const deviceId = getDeviceId();

function getMyReport() {
  try {
    const raw = localStorage.getItem(MY_REPORT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function setMyReport(report) {
  if (report) localStorage.setItem(MY_REPORT_KEY, JSON.stringify(report));
  else localStorage.removeItem(MY_REPORT_KEY);
}

function updateMyReportUI() {
  const my = getMyReport();
  if (my) {
    els.reportFormBlock.style.display = "none";
    els.myReportBlock.style.display = "block";
    els.myReportIcon.textContent = my.status === "open" ? "✓" : "✕";
    els.myReportIcon.className = "my-report-icon " + my.status;
    els.myReportText.textContent = `Gate ${my.status.toUpperCase()} · ${timeAgo(my.time)}`;
  } else {
    els.reportFormBlock.style.display = "block";
    els.myReportBlock.style.display = "none";
  }
}

// ---------- Helpers ----------
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 30) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Haversine formula – distance in meters
function getDistanceFromCrossing(lat, lng) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat - CROSSING_LAT) * Math.PI / 180;
  const dLng = (lng - CROSSING_LNG) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(CROSSING_LAT * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---------- Location check ----------
function checkLocation() {
  if (!navigator.geolocation) {
    setButtonsEnabled(false, "Location not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const dist = getDistanceFromCrossing(
        position.coords.latitude,
        position.coords.longitude
      );

      if (dist <= MAX_DISTANCE_METERS) {
        userAllowedToReport = true;
        setButtonsEnabled(true);
      } else {
        userAllowedToReport = false;
        setButtonsEnabled(false, `You are ${Math.round(dist)}m away (need ≤120m)`);
      }
    },
    (error) => {
      userAllowedToReport = false;
      setButtonsEnabled(false, "Please allow location access to report");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function setButtonsEnabled(enabled, message = null) {
  els.btnOpen.disabled = !enabled;
  els.btnClosed.disabled = !enabled;

  if (enabled) {
    els.btnOpen.classList.remove("disabled");
    els.btnClosed.classList.remove("disabled");
  } else {
    els.btnOpen.classList.add("disabled");
    els.btnClosed.classList.add("disabled");
  }

  const hint = document.querySelector(".report-hint");
  if (hint) {
    hint.textContent = message || "Your report helps others nearby";
  }
}

// ---------- Status logic ----------
function countByStatus(reports) {
  let open = 0, closed = 0;
  reports.forEach((r) => {
    if (r.status === "open") open++;
    else if (r.status === "closed") closed++;
  });
  return { open, closed };
}

function getCurrentStatus(reports) {
  if (!reports.length) {
    return {
      status: "unknown",
      label: "UNKNOWN",
      detail: "No reports yet – be the first",
      icon: "?",
    };
  }

  const latest = reports[0];

  if (latest.status === "open") {
    return {
      status: "open",
      label: "OPEN",
      detail: `Reported open ${timeAgo(latest.time)}`,
      icon: "✓",
    };
  } else {
    return {
      status: "closed",
      label: "CLOSED",
      detail: `Reported closed ${timeAgo(latest.time)}`,
      icon: "✕",
    };
  }
}

function render() {
  const reports = liveReports; // Read from Firebase cache instead of localStorage
  const current = getCurrentStatus(reports);

  els.statusCard.classList.remove("open", "closed", "unknown");
  els.statusCard.classList.add(current.status);
  els.statusIcon.textContent = current.icon;
  els.statusLabel.textContent = current.label;
  els.statusDetail.textContent = current.detail;

  els.reportCount.textContent = reports.length;
  els.reportList.innerHTML = "";

  const tally = countByStatus(reports);
  els.reportTally.innerHTML = reports.length
    ? `<span class="tally-open">${tally.open} Open</span> · <span class="tally-closed">${tally.closed} Closed</span> reported`
    : "";

  if (reports.length === 0) {
    els.emptyState.classList.add("visible");
  } else {
    els.emptyState.classList.remove("visible");

    reports.forEach((r) => {
      const item = document.createElement("div");
      item.className = "report-item";
      item.innerHTML = `
        <span class="report-status ${r.status}">${r.status.toUpperCase()}</span>
        <span class="report-time">${timeAgo(r.time)}</span>
      `;
      els.reportList.appendChild(item);
    });
  }

  els.lastUpdated.textContent = formatTime(new Date());
  updateMyReportUI();
}

async function addReport(status) {
  if (!userAllowedToReport) {
    alert("You must be within 120 meters of Thakazhy Cross to report.");
    return;
  }
  if (getMyReport()) {
    // Shouldn't normally happen since the buttons are hidden once you've
    // reported, but guard against stale UI/double-clicks just in case.
    return;
  }

  setButtonsEnabled(false, "Sending report...");

  try {
    const result = await push(reportsRef, {
      status: status,
      time: Date.now(),
      deviceId: deviceId,
    });
    setMyReport({ id: result.key, status, time: Date.now() });
    updateMyReportUI();
  } catch (error) {
    console.error("Error saving report:", error);
    alert("Failed to send report.");
    setButtonsEnabled(true, "Your report helps others nearby");
  }
}

async function cancelMyReport() {
  const my = getMyReport();
  if (!my) return;

  els.btnCancel.disabled = true;
  els.btnCancel.textContent = "Cancelling…";

  try {
    await remove(ref(db, `reports/${my.id}`));
  } catch (error) {
    console.error("Error cancelling report:", error);
    alert("Failed to cancel your report. Please try again.");
    els.btnCancel.disabled = false;
    els.btnCancel.textContent = "Cancel my report";
    return;
  }

  setMyReport(null);
  els.btnCancel.disabled = false;
  els.btnCancel.textContent = "Cancel my report";
  updateMyReportUI();
  // Re-check location so the report buttons come back correctly enabled/disabled.
  checkLocation();
}

// ---------- Events ----------
els.btnOpen.addEventListener("click", () => addReport("open"));
els.btnClosed.addEventListener("click", () => addReport("closed"));
els.btnCancel.addEventListener("click", cancelMyReport);

// ---------- Init ----------
updateMyReportUI();
setButtonsEnabled(false, "Checking your location...");
checkLocation();

// Real-time Database Listener (Auto-updates UI on any new report)
const q = query(reportsRef, orderByChild("time"), limitToLast(MAX_REPORTS));
onValue(q, (snapshot) => {
  liveReports = [];
  snapshot.forEach((childSnapshot) => {
    // unshift puts the newest items at the top of our array
    liveReports.unshift(childSnapshot.val());
  });
  render(); 
});

// Update the "timeAgo" text every 15 seconds locally
setInterval(render, 15000);