# ClinicPilot — Faseeh Dental Clinic
Web app built by CyberHealth Solutions. Hosted on Netlify. Data stored in Google Sheets.

## Stack
- **Frontend**: Vanilla JS/HTML/CSS (no framework)
- **Backend**: Netlify Serverless Functions (Node.js)
- **Database**: Google Sheets (Patient List + Billings spreadsheets)
- **Auth**: Google Service Account (credentials stored as Netlify env var)

## Project Structure
```
clinicpilot-fdc/
├── netlify/functions/   # Serverless API handlers (one per operation)
├── public/              # Static frontend (index.html, style.css, app.js, api.js)
├── netlify.toml         # Build config + /api/* redirect rules
└── package.json
```

## Setup

### 1. Google Service Account
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Google Sheets API**
3. Create a **Service Account** → Download the JSON key
4. Share both Google Sheets with the service account email (Editor access)

### 2. Netlify Environment Variables
In your Netlify site dashboard → **Site settings → Environment variables**, add:

| Variable | Value |
|---|---|
| `GOOGLE_CREDENTIALS` | Full contents of your service account JSON (as a string) |
| `PATIENT_SHEET_ID` | `1qU85D_wogO1MPht83hLw_KmE0uqicYUMIs-Yo1T1EvA` |
| `BILLING_SHEET_ID` | `1_4GIXvJbFjk0Ak96M82oi1Po7cvI6KOPOdk2JuLos24` |

### 3. Deploy
```bash
# Connect this GitHub repo to Netlify
# Build command: (none — static site)
# Publish directory: public
# Functions directory: netlify/functions (auto-detected via netlify.toml)
```

### 4. Local Dev (optional)
```bash
npm install
npm install -g netlify-cli
# Create .env with the 3 env vars above
netlify dev
```

## Data Model (Google Sheets)
| Sheet | Tab | Contents |
|---|---|---|
| Patient List | Sheet1 | Case No, Name, Phone, Address, Age, Gender |
| Billings | Invoices | All billing records |
| Billings | Appointments | All appointments |
| Billings | Notes | SOAP notes |
| Billings | Report_YYYY-MM | Monthly reports (generated on demand) |

## Notes
- Google Sheets is the source of truth — no local database
- All writes go directly to Sheets via Netlify Functions
- `GOOGLE_CREDENTIALS` env var must be the raw JSON string (not base64)
- Patient IDs follow the format `25XXXX` (e.g. 250001, 250002...)

---
*Powered by CyberHealth Solutions*
