// =============================================================================
// State
// =============================================================================

var hasZAFClient = null;
var client = null;
var ticket = null;
var currentUser = null;
var requester = null;
var assignee = null;
var settings = null;
var currentAccount = null;
var currentUrl = '';
var dynamicContext = {};
var copyTimeout = null;

var DEMO_URL = 'demo.html?ticket_id={ticket_id}&current_user_id={current_user_id}&current_user_email={current_user_email}&requester_id={requester_id}&requester_email={requester_email}&requester_external_id={requester_external_id}&assignee_id={assignee_id}&assignee_email={assignee_email}';

// Maps legacy single-brace tokens to their ZAF dot-notation equivalents.
// Allows old-style URLs to flow through the same dynamic pipeline as new {{}} tokens.
var LEGACY_TOKEN_MAP = {
  '{ticket_id}':             '{{ticket.id}}',
  '{current_user_id}':       '{{currentUser.id}}',
  '{current_user_email}':    '{{currentUser.email}}',
  '{requester_id}':          '{{ticket.requester.id}}',
  '{requester_email}':       '{{ticket.requester.email}}',
  '{requester_external_id}': '{{ticket.requester.externalId}}',
  '{assignee_id}':           '{{ticket.assignee.user.id}}',
  '{assignee_email}':        '{{ticket.assignee.user.email}}'
};

// =============================================================================
// ZAF
// =============================================================================

function initializeZAFClient() {
  try {
    if (typeof window !== 'undefined' && window.ZAFClient) {
      var initResult = window.ZAFClient.init();
      if (initResult) {
        return { client: initResult, hasZAFClient: true };
      }
    }
    return { client: null, hasZAFClient: false };
  } catch (error) {
    console.error('Error initializing ZAF client:', error);
    return { client: null, hasZAFClient: false };
  }
}

async function fetchZAFData() {
  var result = initializeZAFClient();
  client = result.client;
  hasZAFClient = result.hasZAFClient;

  if (!client) return;

  try {
    var responses = await Promise.all([
      client.get('ticket'),
      client.metadata(),
      client.get('currentUser'),
      client.get('ticket.requester'),
      client.get('ticket.assignee.user'),
      client.get('currentAccount')
    ]);

    var ticketRes      = responses[0];
    var metadataRes    = responses[1];
    var currentUserRes = responses[2];
    var requesterRes   = responses[3];
    var assigneeRes    = responses[4];
    var accountRes     = responses[5];

    settings       = metadataRes.settings || null;
    ticket         = ticketRes.ticket || null;
    currentUser    = currentUserRes.currentUser || null;
    requester      = requesterRes['ticket.requester'] || null;
    assignee       = assigneeRes['ticket.assignee.user'] || null;
    currentAccount = accountRes.currentAccount || null;
  } catch (error) {
    console.error('Error fetching ZAF data:', error);
  }
}

// =============================================================================
// Dynamic Token Fetching ({{dot.notation}} support)
// =============================================================================

// Convert any legacy {token} syntax to {{zaf.path}} so it enters the dynamic pipeline
function normalizeLegacyTokens(url) {
  Object.keys(LEGACY_TOKEN_MAP).forEach(function(legacy) {
    url = url.split(legacy).join(LEGACY_TOKEN_MAP[legacy]);
  });
  return url;
}

// Parse a URL template for {{variable}} tokens, return deduplicated list of keys
function getTemplateVariables(url) {
  var varSet = new Set();
  var matches = [...url.matchAll(/{{(.*?)}}/g)];
  matches.forEach(function(m) { varSet.add(m[1].trim()); });
  return [...varSet];
}

// Replace {{key}} tokens in a template string using a context map
function hydrateTemplateString(template, context) {
  return template.replace(/{{(.*?)}}/g, function(_, key) {
    var value = context[key.trim()];
    return (value !== undefined && value !== null) ? String(value) : '';
  });
}

// Synthetic field handlers: resolve .$field suffixes that require identity lookups
var syntheticFieldHandlers = {
  'phone': async function(basePath) {
    var res = await client.get(basePath + '.identities');
    var identityList = res[basePath + '.identities'] || [];
    var match = identityList.find(function(id) { return id.type === 'phone_number'; });
    return match ? match.value : null;
  },
  'phone-us': async function(basePath) {
    var res = await client.get(basePath + '.identities');
    var identityList = res[basePath + '.identities'] || [];
    var match = identityList.find(function(id) { return id.type === 'phone_number'; });
    var value = match ? match.value : '';
    var digits = value.replace(/[^\d]/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.substring(1);
    if (digits.length === 10) return digits;
    return null;
  },
  'twitter': async function(basePath) {
    var res = await client.get(basePath + '.identities');
    var identityList = res[basePath + '.identities'] || [];
    var match = identityList.find(function(id) { return id.type === 'twitter'; });
    return match ? match.value : null;
  },
  'facebook': async function(basePath) {
    var res = await client.get(basePath + '.identities');
    var identityList = res[basePath + '.identities'] || [];
    var match = identityList.find(function(id) { return id.type === 'facebook'; });
    return match ? match.value : null;
  },
  'google': async function(basePath) {
    var res = await client.get(basePath + '.identities');
    var identityList = res[basePath + '.identities'] || [];
    var match = identityList.find(function(id) { return id.type === 'google'; });
    return match ? match.value : null;
  }
};

async function handleSyntheticKey(key) {
  var parts = key.split('.$');
  var basePath = parts[0];
  var syntheticField = parts[1];

  if (!basePath || !syntheticField) {
    return null;
  }

  var handler = syntheticFieldHandlers[syntheticField];
  if (!handler) {
    return null;
  }

  return handler(basePath);
}

// Batch-fetch ZAF data for a list of dot-notation keys.
// Native keys (no .$) are fetched in a single client.get() batch call.
// Synthetic keys (containing .$) are fetched individually via handlers.
async function fetchZendeskDataBatch(keys) {
  var nativeKeys = keys.filter(function(k) { return !k.includes('.$'); });
  var syntheticKeys = keys.filter(function(k) { return k.includes('.$'); });

  var context = {};
  var failedKeys = [];

  try {
    // 1. Fetch native keys in a single batch
    if (nativeKeys.length > 0) {
      var results = await client.get(nativeKeys);
      var errors = results.errors || {};

      nativeKeys.forEach(function(key) {
        if (errors[key]) {
          failedKeys.push(key);
          context[key] = '';
          return;
        }

        var value = results[key];
        // ZAF sometimes wraps values in an object with the key as a property
        if (value && typeof value === 'object' && key in value && Object.keys(value).length <= 2) {
          value = value[key];
        }

        context[key] = (value !== undefined && value !== null) ? value : '';
      });
    }

    // 2. Fetch synthetic keys individually
    for (var i = 0; i < syntheticKeys.length; i++) {
      var key = syntheticKeys[i];
      try {
        var value = await handleSyntheticKey(key);
        context[key] = (value !== null && value !== undefined) ? value : '';
      } catch (error) {
        failedKeys.push(key);
        context[key] = '';
      }
    }

    return context;
  } catch (error) {
    console.error('[Smart iFrame] Error in fetchZendeskDataBatch:', error);
    return null;
  }
}

// Parse the URL template for {{}} tokens, fetch their values, store in dynamicContext,
// and register change listeners so the iframe refreshes when relevant fields update.
async function fetchDynamicData(urlTemplate) {
  var vars = getTemplateVariables(normalizeLegacyTokens(urlTemplate));
  if (vars.length === 0) return;

  var data = await fetchZendeskDataBatch(vars);
  dynamicContext = data || {};

  setupChangeListeners(vars);
}

// Register ZAF .changed event listeners for each dynamic variable used.
// When a relevant field changes, reload the embedded site.
function setupChangeListeners(templateVars) {
  var eventNames = templateVars
    .map(function(v) {
      // Synthetic keys: use the base path for the event name
      if (v.includes('.$')) return v.split('.$')[0] + '.changed';
      return v + '.changed';
    })
    .filter(function(e) {
      // currentUser fields don't change during a ticket session
      return !e.includes('currentUser');
    });

  eventNames.forEach(function(eventName) {
    client.on(eventName, function() {
      loadEmbeddedSite();
    });
  });
}

// =============================================================================
// URL Generation
// =============================================================================

function generateURL() {
  var url;
  if (!settings || !settings.url) {
    console.warn('No URL template found in ZD settings, inserting fallback');
    url = DEMO_URL;
  } else {
    url = settings.url;
  }

  // Normalize any legacy {token} syntax, then hydrate all {{}} tokens from dynamicContext
  url = normalizeLegacyTokens(url);
  url = hydrateTemplateString(url, dynamicContext);

  return url;
}

// =============================================================================
// UI
// =============================================================================

function setUrl(url) {
  currentUrl = url;
  var display = document.getElementById('url-display');
  var iframe  = document.getElementById('embedded-iframe');
  var openBtn = document.getElementById('btn-open');

  display.textContent = url;
  display.title       = url;
  iframe.src          = url;
  openBtn.href        = url;
}

async function loadEmbeddedSite() {
  if (hasZAFClient) {
    var urlTemplate = (settings && settings.url) ? settings.url : DEMO_URL;
    await fetchDynamicData(urlTemplate);

    if (settings && settings.height) {
      client.invoke('resize', { width: '100%', height: settings.height + 'px' });
    } else {
      client.invoke('resize', { width: '100%', height: '300px' });
    }
    setUrl(generateURL());
  } else {
    setUrl(DEMO_URL);
  }
}

// =============================================================================
// Analytics
// =============================================================================

async function identifyUser() {
  try {
    var subdomain  = currentAccount && currentAccount.subdomain;
    var distinctId = subdomain + '_' + currentUser.id;
    var role       = currentUser.role;

    var userStorageKey       = 'user_' + distinctId;
    var storedUserDataString = localStorage.getItem(userStorageKey);
    var storedUserData       = storedUserDataString ? JSON.parse(storedUserDataString) : null;

    var props = {
      zendesk_domain: subdomain,
      role: role
    };

    if (!storedUserData || storedUserData.role !== props.role) {
      localStorage.setItem(userStorageKey, JSON.stringify(props));
      posthog.identify(distinctId, props);
    } else {
      posthog.identify(distinctId);
    }

    var dailyEventKey = 'daily_user_' + distinctId;
    var today         = new Date().toISOString().split('T')[0];
    var lastEventDate = localStorage.getItem(dailyEventKey);
    if (lastEventDate !== today) {
      posthog.capture('daily_user', { zendesk_domain: subdomain, role: role });
      localStorage.setItem(dailyEventKey, today);
    }
  } catch (error) {
    console.error('Error identifying user:', error);
  }
}

// =============================================================================
// Clipboard
// =============================================================================

function copyUrl() {
  if (!navigator.clipboard || !currentUrl) return;
  navigator.clipboard.writeText(currentUrl).then(function () {
    document.getElementById('icon-copy').style.display   = 'none';
    document.getElementById('icon-copied').style.display = '';
    clearTimeout(copyTimeout);
    copyTimeout = setTimeout(function () {
      document.getElementById('icon-copy').style.display   = '';
      document.getElementById('icon-copied').style.display = 'none';
    }, 2000);
  });
}

// =============================================================================
// Init
// =============================================================================

document.addEventListener('DOMContentLoaded', async function () {
  document.getElementById('btn-reload').addEventListener('click', loadEmbeddedSite);
  document.getElementById('btn-copy').addEventListener('click', copyUrl);

  await fetchZAFData();
  await loadEmbeddedSite();

  if (!hasZAFClient) {
    document.getElementById('no-zaf-warning').style.display = '';
  }

  if (client) {
    client.on('app.willDestroy', function () {
      clearTimeout(copyTimeout);
    });

    client.on('app.expanded', async function () {
      await identifyUser();
    });

    var collapsed = await client.get('isCollapsed');
    if (!collapsed.isCollapsed) {
      await identifyUser();
    }
  }
});
