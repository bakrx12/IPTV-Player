let hls;
const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("spinner");
const channelsContainer = document.getElementById("channelsContainer");
const fileInput = document.getElementById("m3uFile");
const uploadFileBtn = document.getElementById("uploadFileBtn");
const m3uUrlInput = document.getElementById("m3uUrlInput");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const searchInput = document.getElementById("searchInput");
const channelCount = document.getElementById("channelCount");

let rawChannelData = [];
let visibleChannels = [];
let currentSelectedIndex = -1;

function showSpinner(show = true) {
  if (spinner) {
    spinner.style.display = show ? "flex" : "none";
  }
}

function playChannel(streamUrl) {
  showSpinner(true);
  
  if (hls) {
    hls.destroy();
    hls = null;
  }
  
  if (Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.once(Hls.Events.MANIFEST_PARSED, () => {
      video.play().then(() => showSpinner(false)).catch(() => showSpinner(false));
    });
    hls.on(Hls.Events.ERROR, () => showSpinner(false));
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamUrl;
    video.play().then(() => showSpinner(false)).catch(() => showSpinner(false));
  } else {
    alert("HLS playback is not supported in this browser.");
    showSpinner(false);
  }
}

// Clean dirty title strings and extract metadata tags + quality resolution
function cleanTitleAndParseTags(extinfLine) {
  let title = "IPTV Channel";
  let country = "";
  let category = "";
  let language = "";
  let quality = "";

  const countryMatch = extinfLine.match(/tvg-country="([^"]+)"/i);
  if (countryMatch) country = countryMatch[1].trim();

  const groupMatch = extinfLine.match(/group-title="([^"]+)"/i);
  if (groupMatch) category = groupMatch[1].trim();

  const langMatch = extinfLine.match(/tvg-language="([^"]+)"/i);
  if (langMatch) language = langMatch[1].trim();

  // Extract title after last comma
  const commaIndex = extinfLine.lastIndexOf(",");
  if (commaIndex !== -1) {
    title = extinfLine.substring(commaIndex + 1).trim();
  }

  // Sanitize title noise
  title = title.replace(/(?:like\s+)?Gecko\)\s*Chrome\/[0-9.]+\s*Safari\/[0-9.]+/gi, "");
  title = title.replace(/group-title="[^"]*"/gi, "");
  title = title.replace(/tvg-[a-zA-Z0-9-]+="[^"]*"/gi, "");

  // Extract resolution / quality including interlaced (e.g. 576i, 1080i, 1080p, 4K, HD)
  const qualityMatch = title.match(/\b(\d{3,4}[pi]|4K|8K|FHD|HD|SD|UHD)\b/i);
  if (qualityMatch) {
    quality = qualityMatch[0];
  }
  else
  {
    quality = "N/A"
  }


  title = title
    .replace(/\s*[\(\[]\s*(\d{3,4}[pi]|4K|8K|FHD|HD|SD|UHD)\s*[\)\]]/gi, "")
    .replace(/\b(\d{3,4}[pi])\b/gi, "")
    .replace(/\s*[\(\[]\s*[\)\]]/g, "") // Remove remaining empty parentheses () or brackets []
    .replace(/^["'\s,]+|["'\s,]+$/g, "")
    .trim();

  return { title: title || "IPTV Channel", country, category, language, quality };
}

function parseChannelList(content) {
  const lines = content.split("\n");
  rawChannelData = [];
  let currentMeta = null;

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;

    if (line.startsWith("#EXTINF")) {
      currentMeta = cleanTitleAndParseTags(line);
    } else if (!line.startsWith("#")) {
      // Captures any stream URL (http, https, rtmp, udp, relative, etc.)
      const streamUrl = line;
      const meta = currentMeta || { title: "IPTV Channel", country: "", category: "", language: "", quality: "" };
      
      rawChannelData.push({
        ...meta,
        streamUrl: streamUrl
      });
      currentMeta = null;
    }
  });

  if (searchInput) searchInput.value = "";
  renderChannels(rawChannelData);
}

function renderChannels(dataList) {
  channelsContainer.innerHTML = "";
  visibleChannels = [];
  currentSelectedIndex = -1;

  dataList.forEach(item => {
    const cardBtn = document.createElement("button");
    cardBtn.className = "channel-card";
    cardBtn.type = "button";

    // Title Row Container (Title + Quality badge side-by-side)
    const titleRow = document.createElement("div");
    titleRow.className = "channel-card-title-row";

    const titleEl = document.createElement("span");
    titleEl.className = "channel-card-title";
    titleEl.textContent = item.title;
    titleRow.appendChild(titleEl);

    // Render Quality badge inline next to the title if available
    if (item.quality) {
      const qualitySpan = document.createElement("span");
      qualitySpan.className = "meta-badge quality-badge";
      qualitySpan.textContent = `${item.quality}`;
      titleRow.appendChild(qualitySpan);
    }

    cardBtn.appendChild(titleRow);

    // Metadata Row (Country, Categories, Language)
    const metaEl = document.createElement("div");
    metaEl.className = "channel-card-meta";

    if (item.country) {
      const countrySpan = document.createElement("span");
      countrySpan.className = "meta-badge";
      countrySpan.textContent = item.country.toUpperCase();
      metaEl.appendChild(countrySpan);
    }

    // Split multi-genre/category strings (by ;, /, or ,) into separate badge cards
    if (item.category) {
      const categories = item.category.split(/[;,/]+/).map(c => c.trim()).filter(Boolean);
      categories.forEach(cat => {
        const catBadge = document.createElement("span");
        catBadge.className = "meta-badge category-badge";
        catBadge.textContent = cat;
        metaEl.appendChild(catBadge);
      });
    }

    if (item.language) {
      const langBadge = document.createElement("span");
      langBadge.className = "meta-badge";
      langBadge.textContent = item.language;
      metaEl.appendChild(langBadge);
    }

    if (metaEl.children.length > 0) {
      cardBtn.appendChild(metaEl);
    }

    cardBtn.addEventListener("click", () => {
      playChannel(item.streamUrl);
      currentSelectedIndex = visibleChannels.indexOf(cardBtn);
      updateSelection();
    });

    channelsContainer.appendChild(cardBtn);
    visibleChannels.push(cardBtn);
  });

  if (channelCount) {
    channelCount.textContent = visibleChannels.length;
  }
}

// Search Filter
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = rawChannelData.filter(item => 
      item.title.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term) ||
      item.country.toLowerCase().includes(term) ||
      item.language.toLowerCase().includes(term) ||
      item.quality.toLowerCase().includes(term)
    );
    renderChannels(filtered);
  });
}

// File and URL loaders
if (uploadFileBtn && fileInput) {
  uploadFileBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => parseChannelList(event.target.result);
    reader.readAsText(file);
  });
}

function loadPlaylistFromUrl(url) {
  if (!url) return alert("Enter a valid playlist URL.");
  showSpinner(true);
  fetch(url)
    .then(res => res.text())
    .then(content => {
      parseChannelList(content);
      showSpinner(false);
    })
    .catch(err => {
      console.error(err);
      alert("Failed to load playlist. Check URL or CORS settings.");
      showSpinner(false);
    });
}

if (loadUrlBtn && m3uUrlInput) {
  loadUrlBtn.addEventListener("click", () => loadPlaylistFromUrl(m3uUrlInput.value.trim()));
  m3uUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadPlaylistFromUrl(m3uUrlInput.value.trim());
  });
}

function updateSelection() {
  visibleChannels.forEach((el, index) => {
    if (index === currentSelectedIndex) {
      el.classList.add("selected");
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      el.classList.remove("selected");
    }
  });
}

// Keyboard Navigation
document.addEventListener("keydown", (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  if (activeTag === "input" || activeTag === "textarea") return;

  if (visibleChannels.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      currentSelectedIndex = (currentSelectedIndex + 1) % visibleChannels.length;
      updateSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      currentSelectedIndex = (currentSelectedIndex - 1 + visibleChannels.length) % visibleChannels.length;
      updateSelection();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentSelectedIndex >= 0) visibleChannels[currentSelectedIndex].click();
    }
  }
});

if (video) {
  video.addEventListener("playing", () => showSpinner(false));
  video.addEventListener("waiting", () => showSpinner(true));
}
