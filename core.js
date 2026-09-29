document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const m3uUrlInput = document.getElementById('m3uUrlInput');
  const loadUrlBtn = document.getElementById('loadUrlBtn');
  const uploadFileBtn = document.getElementById('uploadFileBtn');
  const m3uFileInput = document.getElementById('m3uFile');
  const searchInput = document.getElementById('searchInput');
  const channelsContainer = document.getElementById('channelsContainer');
  const channelCountBadge = document.getElementById('channelCount');
  const globalEpgBtn = document.getElementById('globalEpgBtn');
  const geoBlockedBtn = document.getElementById('geoBlockedBtn');
  const hiddenBadge = document.getElementById('hiddenBadge');
  const channelStatusBar = document.getElementById('channelStatusBar');
  const videoPlayer = document.getElementById('videoPlayer');
  const spinner = document.getElementById('spinner');

  // Context Menu Elements
  const channelContextMenu = document.getElementById('channelContextMenu');
  const ctxBlockChannel = document.getElementById('ctxBlockChannel');
  const ctxGetEpg = document.getElementById('ctxGetEpg');

  // Settings Elements
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const showGeoBlockedToggle = document.getElementById('showGeoBlockedToggle');
  const preferredQualitySelect = document.getElementById('preferredQualitySelect');
  const blockedKeywordsInput = document.getElementById('blockedKeywordsInput');

  // EPG Modal Elements
  const epgModal = document.getElementById('epgModal');
  const closeEpgBtn = document.getElementById('closeEpgBtn');
  const epgModalTitle = document.getElementById('epgModalTitle');
  const epgModalBody = document.getElementById('epgModalBody');

  // Application State
  let channels = [];
  let hlsInstance = null;
  let activeChannelIndex = -1;
  let contextTargetChannel = null;

  // Pagination & Infinite Scroll State
  const BATCH_SIZE = 15;
  let currentlyRenderedCount = 0;

  // Filter States: 'all' | 'only-geo' | 'non-geo'
  let geoFilterState = 'all';
  let showOnlyHidden = false;

  // Settings State (persisted in localStorage)
  let settings = {
    showGeoBlocked: false,
    preferredQuality: 'auto',
    blockedKeywords: []
  };

  // Helper to sanitize title noise and extract tags & logo
  function cleanTitleAndParseTags(extinfLine) {
    let title = "IPTV Channel";
    let country = "";
    let category = "";
    let language = "";
    let quality = "";
    let logo = "";

    const logoMatch = extinfLine.match(/tvg-logo="([^"]+)"/i);
    if (logoMatch) logo = logoMatch[1].trim();

    const countryMatch = extinfLine.match(/tvg-country="([^"]+)"/i);
    if (countryMatch) country = countryMatch[1].trim();

    const groupMatch = extinfLine.match(/group-title="([^"]+)"/i);
    if (groupMatch) category = groupMatch[1].trim();

    const langMatch = extinfLine.match(/tvg-language="([^"]+)"/i);
    if (langMatch) language = langMatch[1].trim();

    const commaIndex = extinfLine.lastIndexOf(",");
    if (commaIndex !== -1) {
      title = extinfLine.substring(commaIndex + 1).trim();
    } else {
      title = extinfLine.replace(/^#EXTINF:-?\d+/, "").trim();
    }

    title = title.replace(/(?:like\s+)?Gecko\)\s*Chrome\/[0-9.]+\s*Safari\/[0-9.]+/gi, "");
    title = title.replace(/group-title="[^"]*"/gi, "");
    title = title.replace(/tvg-[a-zA-Z0-9-]+="[^"]*"/gi, "");

    const qualityMatch = title.match(/\b(\d{3,4}[pi]|4K|8K|FHD|HD|SD|UHD)\b/i);
    if (qualityMatch) {
      quality = qualityMatch[0].toUpperCase();
    } else if (extinfLine.includes('1080p') || extinfLine.includes('FHD')) {
      quality = '1080p';
    } else if (extinfLine.includes('720p') || extinfLine.includes('HD')) {
      quality = '720p';
    } else if (extinfLine.includes('480p') || extinfLine.includes('SD')) {
      quality = '480p';
    } else if (extinfLine.includes('360p')) {
      quality = '360p';
    }

    title = title
      .replace(/\s*[\(\[]\s*(\d{3,4}[pi]\vert{}4K\vert{}8K\vert{}FHD\vert{}HD\vert{}SD\vert{}UHD)\s*[\)\]]/gi, "")
      .replace(/\b(\d{3,4}[pi])\b/gi, "")
      .replace(/\s*[\(\[]\s*[\)\]]/g, "")
      .replace(/^["'\s,]+|["'\s,]+$/g, "")
      .trim();

    return { title: title || "IPTV Channel", country, category, language, quality, logo };
  }

  // Load Settings
  function loadSettings() {
    const saved = localStorage.getItem('iptv_settings');
    if (saved) {
      try {
        settings = Object.assign(settings, JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse settings:', e);
      }
    }
    showGeoBlockedToggle.checked = settings.showGeoBlocked;
    preferredQualitySelect.value = settings.preferredQuality || 'auto';
    blockedKeywordsInput.value = (settings.blockedKeywords || []).join(', ');
  }

  function saveSettings() {
    settings.showGeoBlocked = showGeoBlockedToggle.checked;
    settings.preferredQuality = preferredQualitySelect.value;
    settings.blockedKeywords = blockedKeywordsInput.value
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    localStorage.setItem('iptv_settings', JSON.stringify(settings));
    resetAndRenderChannels();
  }

  // Settings Modal Handlers
  settingsBtn.addEventListener('click', () => settingsModal.classList.add('open'));
  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('open'));
  saveSettingsBtn.addEventListener('click', () => {
    saveSettings();
    settingsModal.classList.remove('open');
  });

  // EPG Modal Handlers
  closeEpgBtn.addEventListener('click', () => epgModal.classList.remove('open'));

  // M3U Parser
  function parseM3U(content) {
    const lines = content.split('\n');
    const parsedChannels = [];
    let currentChannel = null;

    lines.forEach(line => {
      line = line.trim();
      if (line.startsWith('#EXTINF:')) {
        const parsedData = cleanTitleAndParseTags(line);

        currentChannel = {
          name: parsedData.title,
          logo: parsedData.logo,
          url: '',
          group: parsedData.category,
          country: parsedData.country,
          language: parsedData.language,
          quality: parsedData.quality,
          isGeoBlocked: false
        };

        if (/geo[-_]?block|geo=true|is_geo/i.test(line) || /\b(geo[- ]?blocked|geo[- ]?restricted)\b/i.test(parsedData.title)) {
          currentChannel.isGeoBlocked = true;
        }
      } else if (line && !line.startsWith('#') && currentChannel) {
        currentChannel.url = line;
        parsedChannels.push(currentChannel);
        currentChannel = null;
      }
    });

    return parsedChannels;
  }

  function isChannelHiddenByKeyword(channel) {
    if (settings.blockedKeywords.length === 0) return false;
    return settings.blockedKeywords.some(keyword =>
      channel.name.toLowerCase().includes(keyword) || channel.group.toLowerCase().includes(keyword)
    );
  }

  function getFilteredChannels() {
    const query = searchInput.value.toLowerCase().trim();

    return channels.filter(channel => {
      const matchesKeywordBlock = isChannelHiddenByKeyword(channel);

      if (showOnlyHidden) {
        if (!matchesKeywordBlock) return false;
      } else {
        if (matchesKeywordBlock) return false;

        if (!settings.showGeoBlocked && channel.isGeoBlocked) {
          return false;
        }

        if (settings.showGeoBlocked) {
          if (geoFilterState === 'only-geo' && !channel.isGeoBlocked) {
            return false;
          }
          if (geoFilterState === 'non-geo' && channel.isGeoBlocked) {
            return false;
          }
        }
      }

      if (query) {
        const inName = channel.name.toLowerCase().includes(query);
        const inGroup = channel.group.toLowerCase().includes(query);
        const inCountry = channel.country ? channel.country.toLowerCase().includes(query) : false;
        const inLang = channel.language ? channel.language.toLowerCase().includes(query) : false;
        return inName || inGroup || inCountry || inLang;
      }

      return true;
    });
  }

  function getHiddenChannelsCount() {
    return channels.filter(isChannelHiddenByKeyword).length;
  }

  // Create single channel DOM card
 function createChannelCard(channel, index) {
    const btn = document.createElement('button');
    btn.className = 'channel-card';
    if (index === activeChannelIndex) btn.classList.add('selected');

    // Outer flex wrapper separating Logo (left) and Details (right)
    const cardContent = document.createElement('div');
    cardContent.className = 'channel-card-content';

    // Tall Logo Container spanning full height
    const logoWrapper = document.createElement('div');
    logoWrapper.className = 'channel-logo-wrapper';

    if (channel.logo) {
      const logoImg = document.createElement('img');
      logoImg.className = 'channel-logo';
      logoImg.src = channel.logo;
      logoImg.alt = channel.name;
      logoImg.loading = 'lazy';
      logoImg.onerror = () => {
        logoImg.style.display = 'none';
        logoWrapper.textContent = '📺';
      };
      logoWrapper.appendChild(logoImg);
    } else {
      logoWrapper.textContent = '📺';
    }

    // Right details container (Title row + Meta row)
    const cardDetails = document.createElement('div');
    cardDetails.className = 'channel-card-details';

    // Title row
    const titleRow = document.createElement('div');
    titleRow.className = 'channel-card-title-row';

    const title = document.createElement('span');
    title.className = 'channel-card-title';
    title.textContent = channel.name;
    titleRow.appendChild(title);

    if (channel.quality) {
      const qualityBadge = document.createElement('span');
      qualityBadge.className = 'meta-badge quality-badge';
      qualityBadge.textContent = channel.quality;
      titleRow.appendChild(qualityBadge);
    }

    // Meta row (Tags)
    const metaRow = document.createElement('div');
    metaRow.className = 'channel-card-meta';

    if (channel.group) {
      const groupBadge = document.createElement('span');
      groupBadge.className = 'meta-badge category-badge';
      groupBadge.textContent = channel.group;
      metaRow.appendChild(groupBadge);
    }

    if (channel.country) {
      const countryBadge = document.createElement('span');
      countryBadge.className = 'meta-badge category-badge';
      countryBadge.textContent = channel.country;
      metaRow.appendChild(countryBadge);
    }

    if (channel.language) {
      const langBadge = document.createElement('span');
      langBadge.className = 'meta-badge category-badge';
      langBadge.textContent = channel.language;
      metaRow.appendChild(langBadge);
    }

    if (channel.isGeoBlocked) {
      const geoBadge = document.createElement('span');
      geoBadge.className = 'meta-badge geo-blocked-badge';
      geoBadge.textContent = 'Geo-Blocked';
      metaRow.appendChild(geoBadge);
    }

    cardDetails.appendChild(titleRow);
    if (metaRow.children.length > 0) {
      cardDetails.appendChild(metaRow);
    }

    cardContent.appendChild(logoWrapper);
    cardContent.appendChild(cardDetails);
    btn.appendChild(cardContent);

    btn.addEventListener('click', () => {
      playChannel(channel, index);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextTargetChannel = channel;
      channelContextMenu.style.left = `${e.pageX}px`;
      channelContextMenu.style.top = `${e.pageY}px`;
      channelContextMenu.style.display = 'block';
    });

    return btn;
  }

  // Append next batch of 15 channels
  function renderNextBatch() {
    const filtered = getFilteredChannels();
    const batch = filtered.slice(currentlyRenderedCount, currentlyRenderedCount + BATCH_SIZE);

    batch.forEach((channel, i) => {
      const globalIdx = currentlyRenderedCount + i;
      const card = createChannelCard(channel, globalIdx);
      channelsContainer.appendChild(card);
    });

    currentlyRenderedCount += batch.length;
    channelStatusBar.textContent = `Showing ${currentlyRenderedCount} out of ${filtered.length} channels (Total: ${channels.length})`;
  }

  // Full Reset & Initial 15 Render
  function resetAndRenderChannels() {
    channelsContainer.scrollTop = 0;
    channelsContainer.innerHTML = '';
    currentlyRenderedCount = 0;

    const filtered = getFilteredChannels();
    const totalGeoBlocked = channels.filter(c => c.isGeoBlocked).length;
    const hiddenCount = getHiddenChannelsCount();

    // 1. Update Hidden Badge
    if (hiddenCount > 0) {
      hiddenBadge.style.display = 'inline-block';
      if (showOnlyHidden) {
        hiddenBadge.textContent = `Showing Hidden (${hiddenCount})`;
        hiddenBadge.classList.add('active-hidden');
      } else {
        hiddenBadge.textContent = `Hidden (${hiddenCount})`;
        hiddenBadge.classList.remove('active-hidden');
      }
    } else {
      hiddenBadge.style.display = 'none';
      showOnlyHidden = false;
    }

    // 2. Update Geo-Blocked Badge
    if (totalGeoBlocked > 0) {
      geoBlockedBtn.style.display = 'inline-block';
      geoBlockedBtn.className = 'count-badge geo-badge';

      if (!settings.showGeoBlocked || showOnlyHidden) {
        geoBlockedBtn.disabled = true;
        geoBlockedBtn.textContent = `Geo-Blocked (${totalGeoBlocked})`;
        geoBlockedBtn.title = showOnlyHidden 
          ? 'Exit hidden channels mode to filter Geo-Blocked'
          : 'Enable "Show Geo-Blocked Channels" in Settings to filter';
      } else {
        geoBlockedBtn.disabled = false;
        geoBlockedBtn.removeAttribute('title');

        if (geoFilterState === 'only-geo') {
          geoBlockedBtn.textContent = `Geo-Blocked Only (${totalGeoBlocked})`;
          geoBlockedBtn.classList.add('filter-only-geo');
        } else if (geoFilterState === 'non-geo') {
          geoBlockedBtn.textContent = `Non-Geo-Blocked (${channels.length - totalGeoBlocked})`;
          geoBlockedBtn.classList.add('filter-non-geo');
        } else {
          geoBlockedBtn.textContent = `Geo-Blocked (${totalGeoBlocked})`;
          geoBlockedBtn.classList.add('filter-all');
        }
      }
    } else {
      geoBlockedBtn.style.display = 'none';
    }

    channelCountBadge.textContent = `Total: ${channels.length}`;

    // Render initial batch of 15 channels
    renderNextBatch();
  }

  // Infinite Scroll Listener - Trigger batch load when reaching bottom
  channelsContainer.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = channelsContainer;
    const filtered = getFilteredChannels();

    if (scrollTop + clientHeight >= scrollHeight - 50 && currentlyRenderedCount < filtered.length) {
      renderNextBatch();
    }
  });

  document.addEventListener('click', () => {
    channelContextMenu.style.display = 'none';
  });

  ctxBlockChannel.addEventListener('click', () => {
    if (!contextTargetChannel) return;
    const keyword = contextTargetChannel.name.toLowerCase().trim();
    if (keyword && !settings.blockedKeywords.includes(keyword)) {
      settings.blockedKeywords.push(keyword);
      localStorage.setItem('iptv_settings', JSON.stringify(settings));
      blockedKeywordsInput.value = settings.blockedKeywords.join(', ');
      resetAndRenderChannels();
    }
  });

  ctxGetEpg.addEventListener('click', () => {
    if (!contextTargetChannel) return;
    openEpgModalForChannel(contextTargetChannel);
  });

  function openEpgModalForChannel(channel) {
    epgModalTitle.textContent = `📅 EPG: ${channel.name}`;
    epgModalBody.innerHTML = `<p style="color: #aaa;">Fetching guide data for <strong>${channel.name}</strong> from iptv-org/epg...</p>`;
    epgModal.classList.add('open');

    fetch(`https://iptv-org.github.io/epg/guides/us.xml`)
      .then(res => res.text())
      .then(xmlString => {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlString, "text/xml");
        const programmes = Array.from(xml.querySelectorAll('programme'));
        
        const matchedProgs = programmes.filter(p => {
          const title = p.querySelector('title')?.textContent || '';
          return title.toLowerCase().includes(channel.name.toLowerCase());
        }).slice(0, 5);

        if (matchedProgs.length > 0) {
          let html = `<table class="epg-table"><thead><tr><th>Time</th><th>Program Title</th></tr></thead><tbody>`;
          matchedProgs.forEach(p => {
            const title = p.querySelector('title')?.textContent || 'N/A';
            const start = p.getAttribute('start') || 'Now';
            html += `<tr><td>${start.slice(8, 12) || 'Live'}</td><td>${title}</td></tr>`;
          });
          html += `</tbody></table>`;
          epgModalBody.innerHTML = html;
        } else {
          epgModalBody.innerHTML = `<p style="color: #888;">No online EPG data found for "${channel.name}".</p>
          <p style="font-size: 0.8rem; color: #666; margin-top: 8px;">Source: https://github.com/iptv-org/epg</p>`;
        }
      })
      .catch(() => {
        epgModalBody.innerHTML = `<p style="color: #e57373;">Unable to load EPG feed online. Check your internet connection or URL source.</p>
        <p style="font-size: 0.8rem; color: #666; margin-top: 8px;">EPG Repository: https://github.com/iptv-org/epg</p>`;
      });
  }

  globalEpgBtn.addEventListener('click', () => {
    if (channels.length === 0) {
      alert('Please load a playlist first to view the EPG.');
      return;
    }

    epgModalTitle.textContent = `📅 EPG Guide - All Channels`;
    let html = `<table class="epg-table"><thead><tr><th>Channel</th><th>Current Schedule</th></tr></thead><tbody>`;
    const filtered = getFilteredChannels().slice(0, 20);

    filtered.forEach(ch => {
      html += `<tr>
        <td class="epg-channel-header">${ch.name}</td>
        <td>Live Broadcast Stream available. Right-click channel for detailed online EPG.</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    epgModalBody.innerHTML = html;
    epgModal.classList.add('open');
  });

  hiddenBadge.addEventListener('click', () => {
    showOnlyHidden = !showOnlyHidden;
    resetAndRenderChannels();
  });

  geoBlockedBtn.addEventListener('click', () => {
    if (!settings.showGeoBlocked || showOnlyHidden) return;

    if (geoFilterState === 'all') {
      geoFilterState = 'only-geo';
    } else if (geoFilterState === 'only-geo') {
      geoFilterState = 'non-geo';
    } else {
      geoFilterState = 'all';
    }
    resetAndRenderChannels();
  });

  function playChannel(channel, index) {
    activeChannelIndex = index;
    spinner.style.display = 'flex';

    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }

    if (Hls.isSupported() && channel.url.includes('.m3u8')) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(channel.url);
      hlsInstance.attachMedia(videoPlayer);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        spinner.style.display = 'none';

        if (settings.preferredQuality !== 'auto' && data.levels.length > 0) {
          const targetHeight = parseInt(settings.preferredQuality, 10);
          let bestLevelIdx = -1;
          let minDiff = Infinity;

          data.levels.forEach((level, idx) => {
            if (level.height) {
              const diff = Math.abs(level.height - targetHeight);
              if (diff < minDiff) {
                minDiff = diff;
                bestLevelIdx = idx;
              }
            }
          });

          if (bestLevelIdx !== -1) {
            hlsInstance.currentLevel = bestLevelIdx;
          }
        }

        videoPlayer.play().catch(() => {});
      });

      hlsInstance.on(Hls.Events.ERROR, () => {
        spinner.style.display = 'none';
      });
    } else {
      videoPlayer.src = channel.url;
      videoPlayer.play().then(() => {
        spinner.style.display = 'none';
      }).catch(() => {
        spinner.style.display = 'none';
      });
    }
  }

  function startLoading() {
    channelCountBadge.textContent = 'Loading..';
    channelStatusBar.textContent = 'Loading channels...';
    channelsContainer.innerHTML = '';
  }

  loadUrlBtn.addEventListener('click', () => {
    const url = m3uUrlInput.value.trim();
    if (!url) return;

    startLoading();
    fetch(url)
      .then(res => res.text())
      .then(text => {
        channels = parseM3U(text);
        resetAndRenderChannels();
      })
      .catch(err => {
        console.error(err);
        channelCountBadge.textContent = 'Total: 0';
        channelStatusBar.textContent = 'Failed to load channels.';
      });
  });

  uploadFileBtn.addEventListener('click', () => m3uFileInput.click());
  m3uFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    startLoading();
    const reader = new FileReader();
    reader.onload = (event) => {
      channels = parseM3U(event.target.result);
      resetAndRenderChannels();
    };
    reader.readAsText(file);
  });

  searchInput.addEventListener('input', resetAndRenderChannels);

  loadSettings();
});
