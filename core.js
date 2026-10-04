document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const m3uUrlInput = document.getElementById('m3uUrlInput');
  const loadUrlBtn = document.getElementById('loadUrlBtn');
  const uploadFileBtn = document.getElementById('uploadFileBtn');
  const m3uFileInput = document.getElementById('m3uFile');
  const searchInput = document.getElementById('searchInput');
  const channelsContainer = document.getElementById('channelsContainer');
  const channelCountBadge = document.getElementById('channelCount');
  const geoBlockedBtn = document.getElementById('geoBlockedBtn');
  const hiddenBadge = document.getElementById('hiddenBadge');
  const channelStatusBar = document.getElementById('channelStatusBar');
  const videoPlayer = document.getElementById('videoPlayer');
  const spinner = document.getElementById('spinner');
  const audioTrackSelect = document.getElementById('audioTrackSelect');

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
  const preferredLanguageSelect = document.getElementById('preferredLanguageSelect');
  const preferredQualitySelect = document.getElementById('preferredQualitySelect');
  const blockedKeywordsInput = document.getElementById('blockedKeywordsInput');

  // EPG Modal Elements
  const epgModal = document.getElementById('epgModal');
  const closeEpgBtn = document.getElementById('closeEpgBtn');
  const epgModalTitle = document.getElementById('epgModalTitle');
  const epgModalBody = document.getElementById('epgModalBody');
  const epgUrlInput = document.getElementById('epgUrlInput');
  const loadCustomEpgBtn = document.getElementById('loadCustomEpgBtn');

  // Application State
  let channels = [];
  let hlsInstance = null;
  let activeChannelIndex = -1;
  let contextTargetChannel = null;

  // Web Audio Context for Dual-Mono/Channel Splitting
  let audioCtx = null;
  let sourceNode = null;
  let splitterNode = null;
  let mergerNode = null;

  // Pagination & Infinite Scroll State
  const BATCH_SIZE = 15;
  let currentlyRenderedCount = 0;

  // Filter States: 'all' | 'only-geo' | 'non-geo'
  let geoFilterState = 'all';
  let showOnlyHidden = false;

  // Settings State
  let settings = {
    showGeoBlocked: false,
    preferredLanguage: 'en',
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

    const countryMatch = extinfLine.match(/tvg-country="([^"]+)"/i) || extinfLine.match(/tvg-country-code="([^"]+)"/i);
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
    preferredLanguageSelect.value = settings.preferredLanguage || 'en';
    preferredQualitySelect.value = settings.preferredQuality || 'auto';
    blockedKeywordsInput.value = (settings.blockedKeywords || []).join(', ');
  }

  function saveSettings() {
    settings.showGeoBlocked = showGeoBlockedToggle.checked;
    settings.preferredLanguage = preferredLanguageSelect.value;
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

  if (closeEpgBtn) {
    closeEpgBtn.addEventListener('click', () => epgModal.classList.remove('open'));
  }

  // Setup Web Audio API Channel Splitter Engine
  function initWebAudio() {
    if (audioCtx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
      sourceNode = audioCtx.createMediaElementSource(videoPlayer);
      splitterNode = audioCtx.createChannelSplitter(2);
      mergerNode = audioCtx.createChannelMerger(2);

      sourceNode.connect(splitterNode);
      sourceNode.connect(audioCtx.destination);
    } catch (e) {
      console.warn("Web Audio API initialization skipped:", e);
    }
  }

  function setChannelRouting(mode) {
    if (!audioCtx) initWebAudio();
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    sourceNode.disconnect();
    splitterNode.disconnect();
    mergerNode.disconnect();

    if (mode === 'left_only') {
      splitterNode.connect(mergerNode, 0, 0);
      splitterNode.connect(mergerNode, 0, 1);
      mergerNode.connect(audioCtx.destination);
    } else if (mode === 'right_only') {
      splitterNode.connect(mergerNode, 1, 0);
      splitterNode.connect(mergerNode, 1, 1);
      mergerNode.connect(audioCtx.destination);
    } else {
      sourceNode.connect(audioCtx.destination);
    }
  }

  // Audio Track Selection Change Handler
  if (audioTrackSelect) {
    audioTrackSelect.addEventListener('change', (e) => {
      const val = e.target.value;

      if (val === 'split_left') {
        setChannelRouting('left_only');
        return;
      } else if (val === 'split_right') {
        setChannelRouting('right_only');
        return;
      } else {
        setChannelRouting('normal');
      }

      if (val.startsWith("native_") && videoPlayer.audioTracks) {
        const nativeIdx = parseInt(val.replace("native_", ""), 10);
        for (let i = 0; i < videoPlayer.audioTracks.length; i++) {
          videoPlayer.audioTracks[i].enabled = (i === nativeIdx);
        }
        return;
      }

      const trackId = parseInt(val, 10);
      if (hlsInstance && trackId !== -1) {
        hlsInstance.audioTrack = trackId;
        if (videoPlayer && !videoPlayer.paused) {
          videoPlayer.currentTime += 0.01;
        }
      }
    });
  }

  // Unified audio track scanner[cite: 1]
  function scanAndPopulateAudioTracks() {
    if (!audioTrackSelect) return;

    let foundTracks = [];

    if (hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length > 0) {
      hlsInstance.audioTracks.forEach((track, idx) => {
        const langCode = (track.lang || track.language || '').toUpperCase();
        const trackName = track.name || track.groupId || '';
        
        let label = `Audio Track ${idx + 1}`;
        if (langCode && trackName) {
          label = `Audio Track ${idx + 1} - ${langCode} (${trackName})`;
        } else if (langCode) {
          label = `Audio Track ${idx + 1} - ${langCode}`;
        } else if (trackName) {
          label = `Audio Track ${idx + 1} - ${trackName}`;
        }

        foundTracks.push({
          value: idx,
          label: label,
          lang: (track.lang || track.name || label).toLowerCase()
        });
      });
    }

    if (foundTracks.length === 0 && videoPlayer.audioTracks && videoPlayer.audioTracks.length > 0) {
      for (let i = 0; i < videoPlayer.audioTracks.length; i++) {
        const track = videoPlayer.audioTracks[i];
        const langCode = (track.language || '').toUpperCase();
        const trackName = track.label || '';

        let label = `Audio Stream ${i + 1}`;
        if (langCode && trackName) {
          label = `Audio Stream ${i + 1} - ${langCode} (${trackName})`;
        } else if (langCode) {
          label = `Audio Stream ${i + 1} - ${langCode}`;
        } else if (trackName) {
          label = `Audio Stream ${i + 1} - ${trackName}`;
        }

        foundTracks.push({
          value: `native_${i}`,
          label: label,
          lang: (track.language || track.label || label).toLowerCase(),
          enabled: track.enabled
        });
      }
    }

    audioTrackSelect.innerHTML = '';
    
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '-1';
    defaultOpt.textContent = 'Default / Stereo Auto';
    audioTrackSelect.appendChild(defaultOpt);

    if (foundTracks.length > 0) {
      audioTrackSelect.disabled = false;
      let autoIdx = -1;

      foundTracks.forEach((track, idx) => {
        const option = document.createElement('option');
        option.value = track.value;
        option.textContent = track.label;
        if (track.enabled) option.selected = true;

        if (settings.preferredLanguage !== 'auto' && track.lang.includes(settings.preferredLanguage)) {
          autoIdx = idx;
        }
        audioTrackSelect.appendChild(option);
      });

      if (autoIdx !== -1) {
        const target = foundTracks[autoIdx];
        audioTrackSelect.value = target.value;
        if (hlsInstance) hlsInstance.audioTrack = target.value;
      }
    } else {
      audioTrackSelect.disabled = true;

      const optNone = document.createElement('option');
      optNone.value = '-1';
      optNone.textContent = 'No alternative audio tracks found';
      audioTrackSelect.appendChild(optNone);
    }
  }

  if (videoPlayer.audioTracks) {
    videoPlayer.audioTracks.addEventListener('addtrack', scanAndPopulateAudioTracks);
    videoPlayer.audioTracks.addEventListener('removetrack', scanAndPopulateAudioTracks);
  }

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

  // Create channel card DOM
  function createChannelCard(channel, index) {
    const btn = document.createElement('button');
    btn.className = 'channel-card';
    if (index === activeChannelIndex) btn.classList.add('selected');

    const cardContent = document.createElement('div');
    cardContent.className = 'channel-card-content';

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

    const cardDetails = document.createElement('div');
    cardDetails.className = 'channel-card-details';

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

    const metaRow = document.createElement('div');
    metaRow.className = 'channel-card-meta';

    if (channel.language) {
      const langs = channel.language.split(/[;,/]/).map(l => l.trim()).filter(Boolean);
      langs.forEach(lang => {
        const langBadge = document.createElement('span');
        langBadge.className = 'meta-badge category-badge';
        langBadge.textContent = lang;
        metaRow.appendChild(langBadge);
      });
    }

    if (channel.country) {
      const countries = channel.country.split(/[;,/]/).map(c => c.trim()).filter(Boolean);
      countries.forEach(country => {
        const countryBadge = document.createElement('span');
        countryBadge.className = 'meta-badge category-badge';
        countryBadge.textContent = country.toUpperCase();
        metaRow.appendChild(countryBadge);
      });
    }

    if (channel.group) {
      const categories = channel.group.split(/[;,/]/).map(c => c.trim()).filter(Boolean);
      categories.forEach(cat => {
        const groupBadge = document.createElement('span');
        groupBadge.className = 'meta-badge category-badge';
        groupBadge.textContent = cat;
        metaRow.appendChild(groupBadge);
      });
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

  function resetAndRenderChannels() {
    channelsContainer.scrollTop = 0;
    channelsContainer.innerHTML = '';
    currentlyRenderedCount = 0;

    const filtered = getFilteredChannels();
    const totalGeoBlocked = channels.filter(c => c.isGeoBlocked).length;
    const hiddenCount = getHiddenChannelsCount();

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

    renderNextBatch();
  }

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

  // EPG Multi-source Integration Engine with Fuzzy/Loose Fallbacks
  function fetchAndRenderEpgForChannel(channel, customUrl) {
    if (!channel) return;
    epgModalTitle.textContent = `📅 EPG: ${channel.name}`;
    epgModalBody.innerHTML = `<p style="color: #aaa;">Fetching live program schedule for <strong>${channel.name}</strong>...</p>`;
    epgModal.classList.add('open');

    const targetUrl = customUrl || (epgUrlInput ? epgUrlInput.value.trim() : 'https://iptv-org.github.io/epg/guides/us.xml');

    fetch(targetUrl)
      .then(res => res.text())
      .then(xmlString => {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlString, "text/xml");
        const programmes = Array.from(xml.querySelectorAll('programme'));
        
        const cleanQueryName = channel.name
          .replace(/\b(1080p|720p|4K|FHD|HD|SD|HEVC|US|UK|CA|SP|LIVE)\b/gi, '')
          .replace(/[^a-zA-Z0-9]/g, ' ')
          .trim()
          .toLowerCase();

        const searchKeywords = cleanQueryName.split(/\s+/).filter(w => w.length > 2);

        let matchedProgs = programmes.map(p => {
          const title = p.querySelector('title')?.textContent || '';
          const channelAttr = p.getAttribute('channel') || '';
          const titleLower = title.toLowerCase();
          
          let score = 0;
          if (titleLower.includes(cleanQueryName)) score += 10;
          searchKeywords.forEach(kw => {
            if (channelAttr.toLowerCase().includes(kw) || titleLower.includes(kw)) score += 2;
          });

          return { p, score };
        }).filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(item => item.p)
          .slice(0, 15);

        if (matchedProgs.length === 0 && programmes.length > 0) {
          matchedProgs = programmes.slice(0, 10);
        }

        if (matchedProgs.length > 0) {
          let html = `<p style="font-size: 0.8rem; color: #4caf50; margin-bottom: 8px;">✔ Loaded schedule successfully from feed.</p>`;
          html += `<table class="epg-table"><thead><tr><th>Time (UTC)</th><th>Program Title & Description</th></tr></thead><tbody>`;
          
          matchedProgs.forEach(p => {
            const title = p.querySelector('title')?.textContent || 'Live Broadcast';
            const desc = p.querySelector('desc')?.textContent || 'Live stream broadcast item.';
            const startStr = p.getAttribute('start') || '';
            
            let formattedTime = 'Live / Current';
            if (startStr.length >= 12) {
              formattedTime = `${startStr.slice(4,6)}/${startStr.slice(6,8)} - ${startStr.slice(8,10)}:${startStr.slice(10,12)}`;
            }

            html += `<tr><td><strong>${formattedTime}</strong></td><td><strong>${title}</strong><br><span style="font-size: 0.85rem; color: #aaa;">${desc}</span></td></tr>`;
          });
          html += `</tbody></table>`;
          epgModalBody.innerHTML = html;
        } else {
          epgModalBody.innerHTML = `<p style="color: #e57373;">No program schedules found in this XML feed. Try pasting another public XMLTV EPG link into the box above.</p>`;
        }
      })
      .catch(err => {
        console.error(err);
        epgModalBody.innerHTML = `<p style="color: #e57373;">Failed to fetch EPG URL (CORS policy or invalid XML format). Try using a direct raw XMLTV link or a CORS-enabled endpoint.</p>`;
      });
  }

  function openEpgModalForChannel(channel) {
    contextTargetChannel = channel;
    fetchAndRenderEpgForChannel(channel);
  }

  if (loadCustomEpgBtn) {
    loadCustomEpgBtn.addEventListener('click', () => {
      if (contextTargetChannel) {
        fetchAndRenderEpgForChannel(contextTargetChannel, epgUrlInput ? epgUrlInput.value.trim() : null);
      }
    });
  }

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

    setChannelRouting('normal');

    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }

    if (Hls.isSupported() && (channel.url.includes('.m3u8') || channel.url.includes('.ts') || !channel.url.includes('.'))) {
      hlsInstance = new Hls({
        renderTextTracksNatively: false,
        enableWorker: true,
        enableSoftwareAES: true
      });

      hlsInstance.loadSource(channel.url);
      hlsInstance.attachMedia(videoPlayer);

      hlsInstance.on(Hls.Events.AUDIO_TRACKS_UPDATED, scanAndPopulateAudioTracks);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        spinner.style.display = 'none';
        scanAndPopulateAudioTracks();

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

      hlsInstance.on(Hls.Events.FRAG_PARSED, scanAndPopulateAudioTracks);
      hlsInstance.on(Hls.Events.LEVEL_SWITCHED, scanAndPopulateAudioTracks);

      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          spinner.style.display = 'none';
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
            default:
              videoPlayer.src = channel.url;
              videoPlayer.play().catch(() => {});
              break;
          }
        }
      });
    } else {
      videoPlayer.src = channel.url;
      videoPlayer.play().then(() => {
        spinner.style.display = 'none';
        scanAndPopulateAudioTracks();
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
