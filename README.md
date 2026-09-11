# 55 smartCREATIVES — Curated Fine Art & Contemporary Editions

> A modern, responsive, full-stack fine art gallery and acquisition platform built with vanilla HTML5, CSS3, ES6+ JavaScript, Neon PostgreSQL database, and Node.js/Express.

---

## Visual Tone & Aesthetic
- **Style**: "Editorial Luxury" — high-end art gallery aesthetic (curated, spacious, typography-driven).
- **Typography**: Cormorant Garamond display serif headers with clean, legible sans-serif metadata.
- **Palette**: Deep charcoal, soft ivory/linen background, and warm muted gold accents.
- **Currency Engine**: Real-time dual currency valuation support for **USD ($)** and **RWF (FRw)**.

---

## Core Features

### 1. Curated Gallery & Catalog (`index.html`)
- **Dynamic Hero Spotlight**: Highlights featured masterworks with dimensions, medium, and valuation.
- **Curated Catalog Grid**: Filter by discipline (*Oil on Canvas*, *Sculpture & Bronze*, *Plaster & Relief*, *Mixed Media*) or acquisition status (*Available*, *Reserved*, *Sold*).
- **Prominent Artist Attribution**: Distinct artist badges and creation years on every masterwork.
- **Quick View Drawer**: Slide-out drawer for inspecting piece details, curatorial statements, and dimensions.

### 2. High-Precision Artwork Inspect Loupe (`artwork.html`)
- **Studio Loupe Magnifier**: Real-time cursor-following 3x optical loupe to inspect delicate brushstrokes and surface texture on desktop and touch devices.
- **Room Simulation Stage**: Switchable gallery wall view with scaled museum bench to visualize physical artwork scale.
- **Custom Framing Preview**: Interactive frame switcher (*Floating Charcoal Oak*, *Brushed Gilded Brass*, *Natural Maple*, *Unframed*).

### 3. Collector / Patron Portal (`auth.html`)
- **Authentication**: Sign in or register as a collector.
- **Acquisitions Timeline**: Track inquiry dossiers across real-time stages with curatorial directorate notes.
- **Saved Masterworks**: Private collection wishlist.
- **Patron Profile**: Manage residential delivery address for white-glove shipping.

### 4. Curator Directorate & Product Management (`admin.html`)
- **Curator Authentication**: Secure administration portal.
- **Full Artwork CRUD**: Add, edit, or deaccession pieces permanently from the Neon PostgreSQL database.
- **Smart Device Image Upload**: Client-side canvas compression automatically optimizes photos (<200KB) for permanent cloud database storage.
- **Inquiry Management**: Review incoming buyer dossiers, assign status, and reply with curator notes.

---

## Quick Start

### Installation
```bash
# Clone the repository
git clone https://github.com/ndyanaboeddy512-lgtm/smartCREATIVES.git

# Enter project directory
cd smartCREATIVES

# Install dependencies
npm install

# Start the gallery server
npm start
```
The server will start at: `http://localhost:3000`

---

## Access Points & Credentials

| Role / Portal | URL | Demo Email | Demo Password |
|---|---|---|---|
| **55 smartCREATIVES Gallery** | `http://localhost:3000/` | *Public Access* | — |
| **Curator Directorate** | `http://localhost:3000/admin.html` | `edsonndyanabo84@gmail.com` | `EddyPro256` |
| **Collector Salon** | `http://localhost:3000/auth.html` | `a.sterling@mayfairholdings.co.uk` | `password123` |

---

## Project Structure
```
smartCREATIVES/
├── index.html          # Public gallery landing & studio spotlight
├── artwork.html        # Optical loupe inspector & room view
├── auth.html           # Collector portal, inquiry tracking & wishlist
├── admin.html          # Curator administration & product management
├── app.js              # Global state engine, currency converter & modal handlers
├── admin.js            # Admin CRUD, upload, and dossier pipeline logic
├── server.js           # Express REST API, upload handler & PostgreSQL persistence
├── db.js               # Universal PostgreSQL / Neon SQL Adapter
├── styles.css          # Responsive styling & typography
├── data/
│   ├── artworks.json   # Seed catalog archive
│   ├── inquiries.json  # Acquisition inquiries & curator logs
│   ├── admin.json      # Curator directorate credentials
│   └── users.json      # Registered patron profiles
└── images/             # Local high-resolution artwork photography
```

---

## License
MIT License. Crafted by **55 smartCREATIVES — Fine Art & Curated Editions**.
