# Smart iFrame — Zendesk App

Embed any website into the Zendesk ticket sidebar using dynamic URLs built from live ticket data.

**Zendesk Marketplace:** https://www.zendesk.com/marketplace/apps/support/1020069/smart-iframe/

---

## How It Works

Configure a URL in the app settings. Use `{{double braces}}` to inject live Zendesk data — ticket fields, requester details, custom fields, identity fields — before the iframe loads.

**Example:** `https://mysite.com/lookup?ticket={{ticket.id}}&email={{ticket.requester.email}}`

The iframe URL updates automatically whenever a relevant ticket field changes.

---

## Template Variables

### Ticket

| Variable | Description |
|---|---|
| `{{ticket.id}}` | Ticket ID |
| `{{ticket.subject}}` | Subject line |
| `{{ticket.status}}` | Status |
| `{{ticket.priority}}` | Priority |
| `{{ticket.type}}` | Type |
| `{{ticket.brand.id}}` | Brand ID |
| `{{ticket.form.id}}` | Form ID |
| `{{ticket.customField:custom_field_<field_id>}}` | Custom field value |

### Requester (End-User)

| Variable | Description |
|---|---|
| `{{ticket.requester.id}}` | Requester user ID |
| `{{ticket.requester.email}}` | Requester email |
| `{{ticket.requester.externalId}}` | Requester external ID |
| `{{ticket.requester.$phone}}` | Phone number, e.g. `+15556667777` |
| `{{ticket.requester.$phone-us}}` | US phone, digits only, e.g. `5556667777` |
| `{{ticket.requester.$twitter}}` | Twitter/X handle |
| `{{ticket.requester.$facebook}}` | Facebook identity |
| `{{ticket.requester.$google}}` | Google identity |

### Organization

| Variable | Description |
|---|---|
| `{{ticket.organization.id}}` | Organization ID |
| `{{ticket.organization.name}}` | Organization name |

### Assignee (Agent)

| Variable | Description |
|---|---|
| `{{ticket.assignee.user.id}}` | Assigned agent ID |
| `{{ticket.assignee.user.email}}` | Assigned agent email |
| `{{ticket.assignee.group.id}}` | Assigned group ID |

### Current User (Agent Viewing the Ticket)

| Variable | Description |
|---|---|
| `{{currentUser.id}}` | Current agent ID |
| `{{currentUser.email}}` | Current agent email |

### Legacy Variables

The original 8 single-brace variables are still fully supported and map automatically to their dot-notation equivalents.

| Legacy | Equivalent |
|---|---|
| `{ticket_id}` | `{{ticket.id}}` |
| `{current_user_id}` | `{{currentUser.id}}` |
| `{current_user_email}` | `{{currentUser.email}}` |
| `{requester_id}` | `{{ticket.requester.id}}` |
| `{requester_email}` | `{{ticket.requester.email}}` |
| `{requester_external_id}` | `{{ticket.requester.externalId}}` |
| `{assignee_id}` | `{{ticket.assignee.user.id}}` |
| `{assignee_email}` | `{{ticket.assignee.user.email}}` |

---

## Project Structure

```
manifest.json          — ZD app manifest (version, parameters, location)
translations/en.json   — Marketplace listing copy
assets/
  index.html           — App shell (loads ZAF SDK, PostHog, styles, app.js)
  app.js               — Core logic: token fetching, URL hydration, analytics
  app.css              — Styles
  demo.html            — Bundled demo page shown when no URL is configured
```

## Packaging

Requires [ZCLI](https://developer.zendesk.com/documentation/apps/getting-started/using-the-apps-cli/).

```bash
zcli apps:validate .
zcli apps:package
```

Output zip is written to `tmp/`. Upload to the Zendesk Marketplace developer portal.

---

Built by [Hubbub Studios](https://hubbub.dev). Questions: support@hubbub.dev — [Terms of Service](./TERMS-OF-SERVICE.md)
