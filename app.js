/**
 * 55 smartCREATIVES — Editorial Luxury Fine Art Gallery
 * Core Application Engine & Data Bridge
 */

// Default Fallback Seed Catalog (Guarantees zero-failure standalone execution)
const DEFAULT_ARTWORKS = [
  {
    id: "art-mtkeap1c",
    title: "Natural Wood Balance",
    artist: "Eddy",
    year: 2026,
    medium: "Carved solid wood",
    dimensions: "64 × 84 × 67 cm",
    price: 900,
    status: "Available",
    framing: "Natural Wood Stand (Included)",
    frameOptions: ["Natural Wood Stand", "Black Steel Base", "Modern Floating Mount"],
    provenance: "Direct from artist Eddy. 100% original, one-of-a-kind artwork.",
    curatorialStatement: "A clean, modern sculpture handcrafted from natural wood, highlighting authentic grain and organic balance.",
    featured: false,
    image: "images/artwork-1788371635007-145.jpg",
    highResZoom: "images/artwork-1788371635007-145.jpg"
  },
  {
    id: "art-01",
    title: "Night Shadows in Warm Earth",
    artist: "Eleanor Vance",
    year: 2025,
    medium: "Oil and natural earth pigments on canvas",
    dimensions: "190 × 140 cm / 75 × 55 in",
    price: 24500,
    status: "Available",
    framing: "Handmade floating oak frame (Included)",
    frameOptions: ["Floating Black Oak Frame", "Brushed Gold Brass Frame", "Natural Light Maple Frame", "Unframed Gallery Canvas"],
    provenance: "Direct from the artist studio. Includes signed Certificate of Authenticity.",
    curatorialStatement: "A stunning original painting featuring deep shadows and warm earth tones. Created with hand-mixed natural pigments on premium canvas.",
    featured: true,
    image: "images/art-01.jpg",
    highResZoom: "images/art-01.jpg"
  },
  {
    id: "art-02",
    title: "Modern Bronze Form",
    artist: "Mateo Rossi",
    year: 2024,
    medium: "Cast solid bronze with warm patina",
    dimensions: "78 × 42 × 35 cm / 31 × 16 × 14 in",
    price: 19800,
    status: "Available",
    framing: "Includes custom black marble display stand",
    frameOptions: ["Black Marble Stand", "Brushed Steel Stand", "Modern Concrete Stand"],
    provenance: "Direct from sculptor studio. Numbered 1 of 1 original. Includes Certificate of Authenticity.",
    curatorialStatement: "A timeless bronze sculpture with smooth curves and tactile texture, resting securely on an elegant polished marble base.",
    featured: false,
    image: "images/art-02.jpg",
    highResZoom: "images/art-02.jpg"
  },
  {
    id: "art-03",
    title: "Minimalist White Relief",
    artist: "Soren Lindqvist",
    year: 2025,
    medium: "Textured plaster and mineral relief on wood panel",
    dimensions: "120 × 120 cm / 47 × 47 in",
    price: 16500,
    status: "Available",
    framing: "Slim white gallery frame (Included)",
    frameOptions: ["Slim White Gallery Frame", "Floating Black Oak Frame", "Natural Maple Frame"],
    provenance: "Original studio piece. Accompanied by artist-signed certificate.",
    curatorialStatement: "A calm, elegant white textured wall artwork that catches ambient light throughout the day, creating gentle geometric shadows.",
    featured: false,
    image: "images/art-03.jpg",
    highResZoom: "images/art-03.jpg"
  },
  {
    id: "art-04",
    title: "Warm Terracotta Abstract",
    artist: "Clara Beauchamp",
    year: 2024,
    medium: "Oil and warm clay pigments on heavy linen",
    dimensions: "160 × 130 cm / 63 × 51 in",
    price: 22000,
    status: "Reserved",
    framing: "Solid walnut floating frame (Included)",
    frameOptions: ["Solid Walnut Floating Frame", "Black Oak Frame", "Raw Canvas Edge"],
    provenance: "Exhibited at private London gallery. Fully authenticated original.",
    curatorialStatement: "A rich, grounded composition using warm terracotta, sand, and cream tones to bring warmth and comfort into living spaces.",
    featured: false,
    image: "images/art-04.jpg",
    highResZoom: "images/art-04.jpg"
  },
  {
    id: "art-05",
    title: "Architectural Steel & Stone",
    artist: "Kaito Moriyama",
    year: 2025,
    medium: "Blackened steel and carved volcanic stone",
    dimensions: "92 × 48 × 40 cm / 36 × 19 × 16 in",
    price: 31000,
    status: "Available",
    framing: "Integrated weighted architectural stand",
    frameOptions: ["Integrated Steel Stand", "Gallery Pedestal (Optional)"],
    provenance: "Direct studio piece. Verified authentic by 55 smartCREATIVES Gallery.",
    curatorialStatement: "A bold sculpture combining dark structural steel with hand-carved stone, inspired by modern architectural geometry.",
    featured: false,
    image: "images/art-05.jpg",
    highResZoom: "images/art-05.jpg"
  },
  {
    id: "art-06",
    title: "Golden Sunset Horizon",
    artist: "Eleanor Vance",
    year: 2025,
    medium: "Oil painting with subtle 24K gold leaf accents",
    dimensions: "200 × 150 cm / 79 × 59 in",
    price: 27500,
    status: "Available",
    framing: "Custom gilded edge frame (Included)",
    frameOptions: ["Gilded Brass Frame", "Charcoal Floating Frame", "Unframed Gallery Linen"],
    provenance: "Original studio creation. Includes signed certificate and authentication documents.",
    curatorialStatement: "A luminous abstract landscape capturing the warm glow of dusk. Gentle gold details reflect sunlight and ambient lighting.",
    featured: false,
    image: "images/art-06.jpg",
    highResZoom: "images/art-06.jpg"
  },
  {
    id: "art-07",
    title: "White Marble Curves",
    artist: "Mateo Rossi",
    year: 2024,
    medium: "Solid white Carrara marble, hand-polished",
    dimensions: "65 × 38 × 30 cm / 26 × 15 × 12 in",
    price: 26000,
    status: "Sold",
    framing: "Includes protective felted display base",
    frameOptions: ["Polished White Marble Base", "Dark Walnut Pedestal"],
    provenance: "Sold to private collection in London. Archived in gallery permanent catalog.",
    curatorialStatement: "Carved from a single block of authentic white marble, featuring smooth flowing lines and a satiny hand-finished touch.",
    featured: false,
    image: "images/art-07.jpg",
    highResZoom: "images/art-07.jpg"
  },
  {
    id: "art-08",
    title: "Natural Linen & Earth Tones",
    artist: "Soren Lindqvist",
    year: 2025,
    medium: "Woven raw linen, natural beeswax, and walnut stain",
    dimensions: "150 × 110 cm / 59 × 43 in",
    price: 21500,
    status: "Available",
    framing: "Light oak shadowbox frame with museum glass",
    frameOptions: ["Light Oak Shadowbox Frame", "Matte Black Frame", "Natural Unframed Edge"],
    provenance: "Studio archive piece. Complete with artist signature on reverse.",
    curatorialStatement: "An organic textile artwork made from pure natural materials, bringing calm serenity and rich texture into modern interiors.",
    featured: false,
    image: "images/art-08.jpg",
    highResZoom: "images/art-08.jpg"
  }
];

const DEFAULT_INQUIRIES = [
  {
    id: "inq-101",
    artworkId: "art-04",
    artworkTitle: "Warm Terracotta Abstract",
    artworkArtist: "Clara Beauchamp",
    artworkPrice: 22000,
    artworkImage: "images/art-04.jpg",
    collectorName: "John Sterling",
    collectorEmail: "a.sterling@mayfairholdings.co.uk",
    collectorPhone: "+44 20 7946 0912",
    framePreference: "Solid Walnut Floating Frame",
    notes: "Looking to purchase this piece with insured delivery to London.",
    status: "Contacted",
    date: "2026-08-28T14:20:00Z",
    curatorNotes: "Spoke with client. Provided Certificate of Authenticity and shipping options."
  },
  {
    id: "inq-102",
    artworkId: "art-01",
    artworkTitle: "Night Shadows in Warm Earth",
    artworkArtist: "Eleanor Vance",
    artworkPrice: 24500,
    artworkImage: "images/art-01.jpg",
    collectorName: "Sarah Jenkins",
    collectorEmail: "margaux.delacroix@artcapital.fr",
    collectorPhone: "+1 415 555 2671",
    framePreference: "Floating Black Oak Frame",
    notes: "We would like to reserve this piece for our home in San Francisco.",
    status: "Pending",
    date: "2026-09-01T09:45:00Z",
    curatorNotes: "Inquiry received. Awaiting client confirmation."
  }
];

// Unified Data Store
const EddyStore = {
  isBackendConnected: false,
  artworks: [],
  inquiries: [],
  currency: (localStorage.getItem('eddy_currency') === 'RWF' ? 'RWF' : 'USD'),
  exchangeRates: { USD: 1.0, RWF: 1400 },
  currencySymbols: { USD: '$', RWF: 'FRw ' },
  wishlist: JSON.parse(localStorage.getItem('eddy_wishlist') || '[]'),
  currentCollector: JSON.parse(localStorage.getItem('eddy_collector_session') || 'null'),

  async init() {
    // Attempt connecting to the lightweight Express REST API
    try {
      const res = await fetch('/api/artworks');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        this.artworks = await res.json();
        this.isBackendConnected = true;
        this.saveArtworksLocally();
        console.log(`✓ Connected to 55 smartCREATIVES Express Backend (${this.artworks.length} artworks loaded)`);
      } else {
        throw new Error(`API responded with status ${res.status}`);
      }
    } catch (err) {
      console.warn('Backend server not detected or offline. Utilizing local persistence engine.', err.message);
      this.isBackendConnected = false;
      const cached = localStorage.getItem('eddy_artworks');
      this.artworks = cached ? JSON.parse(cached) : DEFAULT_ARTWORKS;
      this.saveArtworksLocally();
    }

    // Load inquiries with smart local/server merge
    await this.fetchInquiries();

    // Load visitor reviews & testimonials
    await this.fetchReviews();

    this.updateWishlistBadge();
    this.initCurrencyButtons();
    this.updateUserNav();

    // Dispatch global event so UI components immediately render the updated catalog
    window.dispatchEvent(new CustomEvent('artworksLoaded', { detail: this.artworks }));
    return this.artworks;
  },

  async fetchInquiries() {
    let serverInquiries = [];

    // Fetch authoritative inquiries strictly from the live database
    try {
      const headers = {};
      const curatorToken = localStorage.getItem('eddy_curator_token');
      if (curatorToken) {
        headers['Authorization'] = `Bearer ${curatorToken}`;
      }
      const res = await fetch('/api/inquiries', { headers });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        serverInquiries = await res.json();
        this.isBackendConnected = true;
      }
    } catch (err) {
      console.warn('Notice fetching inquiries from server:', err.message);
    }

    if (Array.isArray(serverInquiries)) {
      this.inquiries = serverInquiries;
    } else {
      this.inquiries = [];
    }

    // Sort newest first
    this.inquiries.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    window.dispatchEvent(new CustomEvent('inquiriesUpdated', { detail: this.inquiries }));
    return this.inquiries;
  },

  updateUserNav() {
    const sessionStr = localStorage.getItem('eddy_collector_session');
    let session = null;
    try { session = JSON.parse(sessionStr); } catch (e) {}

    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href.includes('auth.html') || link.id === 'navCollectorLink') {
        if (session && session.name) {
          link.innerHTML = `✦ ${session.name}`;
          link.title = `Signed in as ${session.name} (${session.tier || 'Patron'})`;
        } else {
          link.textContent = 'Collector Portal';
        }
      }
    });

    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href.includes('auth.html')) {
        if (session && session.name) {
          link.innerHTML = `✦ ${session.name} (Portal)`;
        } else {
          link.textContent = 'Collector Portal';
        }
      }
    });
  },

  saveArtworksLocally() {
    try {
      localStorage.setItem('eddy_artworks', JSON.stringify(this.artworks));
    } catch (e) {
      console.warn('LocalStorage artwork cache quota exceeded, caching lightweight catalog:', e.message);
      try {
        const lightweight = this.artworks.map(a => {
          if (a.image && a.image.startsWith('data:image/')) {
            return { ...a, image: 'images/art-01.jpg', highResZoom: 'images/art-01.jpg' };
          }
          return a;
        });
        localStorage.setItem('eddy_artworks', JSON.stringify(lightweight));
      } catch (innerErr) {
        console.warn('Could not cache artworks in localStorage:', innerErr.message);
      }
    }
    window.dispatchEvent(new CustomEvent('artworksUpdated', { detail: this.artworks }));
  },


  async addInquiry(inquiryData) {
    // Direct submission to secure server-side API
    let res;
    try {
      res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inquiryData)
      });
    } catch (netErr) {
      throw new Error('Network connection error. Please check your internet connection and try again.');
    }

    const contentType = res.headers.get('content-type') || '';
    let result = null;
    if (contentType.includes('application/json')) {
      try {
        result = await res.json();
      } catch (e) {
        result = null;
      }
    }

    if (!res.ok) {
      const serverMessage = result && (result.message || result.error);
      const errMsg = serverMessage || `The gallery server could not process your inquiry at this moment (HTTP ${res.status}). Please try again shortly or contact the curator directly.`;
      throw new Error(errMsg);
    }

    if (!result) {
      throw new Error('Received an unexpected response format from the server. Please refresh the page and try again.');
    }

    const saved = result.inquiry || result;
    this.inquiries.unshift(saved);
    window.dispatchEvent(new CustomEvent('inquiriesUpdated', { detail: this.inquiries }));
    return saved;
  },

  reviews: [],

  async fetchReviews(artworkId = null) {
    try {
      const url = artworkId ? `/api/reviews?artworkId=${encodeURIComponent(artworkId)}` : '/api/reviews';
      const res = await fetch(url);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        this.reviews = await res.json();
      }
    } catch (e) {
      console.warn('Notice loading reviews from server', e);
    }
    window.dispatchEvent(new CustomEvent('reviewsLoaded', { detail: this.reviews }));
    return this.reviews;
  },

  async addReview(reviewData) {
    let res;
    try {
      res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewData)
      });
    } catch (netErr) {
      throw new Error('Network connection error. Please try again.');
    }

    const contentType = res.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
    }
    if (!res.ok) {
      const errMsg = (data && (data.message || data.error)) || `Failed to submit review (Server status ${res.status})`;
      throw new Error(errMsg);
    }
    return data;
  },

  getArtworkById(id) {
    return this.artworks.find(a => a.id === id) || this.artworks[0];
  },

  formatPrice(amountUSD) {
    const rate = this.exchangeRates[this.currency] || 1.0;
    const symbol = this.currencySymbols[this.currency] || '$';
    const converted = Math.round(amountUSD * rate);
    return `${symbol}${converted.toLocaleString()}`;
  },

  setCurrency(curr) {
    if (this.exchangeRates[curr]) {
      this.currency = curr;
      localStorage.setItem('eddy_currency', curr);
      this.initCurrencyButtons();
      // Dispatch re-render event
      window.dispatchEvent(new CustomEvent('currencyChanged', { detail: curr }));
    }
  },

  initCurrencyButtons() {
    document.querySelectorAll('.currency-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.curr === this.currency);
    });
  },

  toggleWishlist(artworkId) {
    const idx = this.wishlist.indexOf(artworkId);
    if (idx > -1) {
      this.wishlist.splice(idx, 1);
    } else {
      this.wishlist.push(artworkId);
    }
    localStorage.setItem('eddy_wishlist', JSON.stringify(this.wishlist));
    this.updateWishlistBadge();
    window.dispatchEvent(new CustomEvent('wishlistUpdated', { detail: this.wishlist }));
    return this.isWishlisted(artworkId);
  },

  isWishlisted(artworkId) {
    return this.wishlist.includes(artworkId);
  },

  updateWishlistBadge() {
    const badges = document.querySelectorAll('.wishlist-badge');
    badges.forEach(b => {
      b.textContent = this.wishlist.length;
      b.style.display = this.wishlist.length > 0 ? 'inline-flex' : 'none';
    });
  }
};

// Sanitization Utility to prevent XSS
function sanitizeHTML(str) {
  if (!str) return '';
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

// Global Acquisition Inquiry Modal Handler
window.openInquiryModal = function(artworkId) {
  const artwork = EddyStore.getArtworkById(artworkId);
  if (!artwork) return;

  const modal = document.getElementById('inquiryModal');
  if (!modal) return;

  // Populate piece details in the modal
  document.getElementById('modalArtworkId').value = artwork.id;
  document.getElementById('modalArtworkTitleInput').value = artwork.title;
  document.getElementById('modalArtworkPriceInput').value = artwork.price;
  document.getElementById('modalArtworkImageInput').value = artwork.image;
  // Set client time-gate timestamp
  const inqTs = document.getElementById('inquiryTimestamp');
  if (inqTs) inqTs.value = Date.now();

  document.getElementById('modalArtworkTitle').textContent = artwork.title;
  document.getElementById('modalArtworkArtist').textContent = (artwork.artist || '55 smartCREATIVES Studio') + (artwork.year ? ` (${artwork.year})` : '');
  document.getElementById('modalArtworkPrice').textContent = EddyStore.formatPrice(artwork.price);
  document.getElementById('modalArtworkThumb').src = artwork.image;

  // Auto-fill logged-in collector info if present
  let activeSession = EddyStore.currentCollector;
  if (!activeSession) {
    try { activeSession = JSON.parse(localStorage.getItem('eddy_collector_session')); } catch(e) {}
  }
  if (activeSession) {
    const nameInput = document.getElementById('inquiryName');
    const emailInput = document.getElementById('inquiryEmail');
    const phoneInput = document.getElementById('inquiryPhone');
    if (nameInput && !nameInput.value) nameInput.value = activeSession.name || '';
    if (emailInput && !emailInput.value) emailInput.value = activeSession.email || '';
    if (phoneInput && !phoneInput.value && activeSession.phone) phoneInput.value = activeSession.phone;
  }

  // Populate framing choices
  const frameSelect = document.getElementById('inquiryFraming');
  if (frameSelect) {
    frameSelect.innerHTML = '';
    const options = artwork.frameOptions && artwork.frameOptions.length > 0
      ? artwork.frameOptions
      : ["Included Studio Framing", "Floating Charcoal Oak", "Brushed Gilded Brass", "Natural Scandinavian Maple"];
    
    options.forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = opt;
      optionEl.textContent = opt;
      frameSelect.appendChild(optionEl);
    });
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeInquiryModal = function() {
  const modal = document.getElementById('inquiryModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

// Global Quick-View Slideover Handler
window.openQuickView = function(artworkId) {
  const artwork = EddyStore.getArtworkById(artworkId);
  if (!artwork) return;

  const drawer = document.getElementById('quickViewDrawer');
  if (!drawer) {
    // If not on index page, navigate to artwork.html
    window.location.href = `artwork.html?id=${encodeURIComponent(artworkId)}`;
    return;
  }

  document.getElementById('qvThumb').src = artwork.image;
  document.getElementById('qvTitle').textContent = artwork.title;
  document.getElementById('qvArtist').textContent = artwork.artist || '55 smartCREATIVES Studio';
  const qvYearEl = document.getElementById('qvYear');
  if (qvYearEl) qvYearEl.textContent = artwork.year ? `(${artwork.year})` : '';
  document.getElementById('qvMedium').textContent = artwork.medium;
  document.getElementById('qvDimensions').textContent = artwork.dimensions;
  document.getElementById('qvPrice').textContent = EddyStore.formatPrice(artwork.price);
  document.getElementById('qvStatement').textContent = artwork.curatorialStatement;
  
  const statusEl = document.getElementById('qvStatus');
  statusEl.textContent = artwork.status;
  statusEl.className = `status-badge ${artwork.status.toLowerCase()}`;

  const viewDeepLink = document.getElementById('qvDeepLink');
  if (viewDeepLink) {
    viewDeepLink.href = `artwork.html?id=${encodeURIComponent(artwork.id)}`;
  }

  const qvInquireBtn = document.getElementById('qvInquireBtn');
  if (qvInquireBtn) {
    qvInquireBtn.onclick = () => {
      window.closeQuickView();
      window.openInquiryModal(artwork.id);
    };
  }

  drawer.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeQuickView = function() {
  const drawer = document.getElementById('quickViewDrawer');
  if (drawer) {
    drawer.classList.remove('active');
    document.body.style.overflow = '';
  }
};

// Wire up global listeners when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  await EddyStore.init();

  // Currency click delegates
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      EddyStore.setCurrency(btn.dataset.curr);
    });
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.closeInquiryModal();
      window.closeQuickView();
    });
  });

  // Backdrop clicks
  const modalBackdrop = document.getElementById('inquiryModal');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) window.closeInquiryModal();
    });
  }

  const drawerBackdrop = document.getElementById('quickViewDrawer');
  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', (e) => {
      if (e.target === drawerBackdrop) window.closeQuickView();
    });
  }

  // Inquiry Form Submission
  const inquiryForm = document.getElementById('acquisitionInquiryForm');
  if (inquiryForm) {
    inquiryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = inquiryForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Sending Inquiry...';
      submitBtn.disabled = true;

      const inquiryData = {
        artworkId: document.getElementById('modalArtworkId').value,
        artworkTitle: document.getElementById('modalArtworkTitleInput').value,
        artworkArtist: document.getElementById('modalArtworkArtistInput').value,
        artworkPrice: parseFloat(document.getElementById('modalArtworkPriceInput').value),
        artworkImage: document.getElementById('modalArtworkImageInput').value,
        collectorName: sanitizeHTML(document.getElementById('inquiryName').value.trim()),
        collectorEmail: sanitizeHTML(document.getElementById('inquiryEmail').value.trim()),
        collectorPhone: sanitizeHTML(document.getElementById('inquiryPhone').value.trim()),
        framePreference: document.getElementById('inquiryFraming').value,
        notes: sanitizeHTML(document.getElementById('inquiryNotes')?.value?.trim() || ''),
        _ts: (document.getElementById('inquiryTimestamp')?.value) || (Date.now() - 3000),
        website_hp: document.getElementById('inquiryHoneypot')?.value || document.getElementById('inquiryWebsiteHp')?.value || ''
      };

      try {
        const saved = await EddyStore.addInquiry(inquiryData);
        
        // Render simple clean confirmation within modal
        const modalBody = document.querySelector('#inquiryModal .modal-body');
        modalBody.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem;">
            <div style="width: 60px; height: 60px; border-radius: 50%; background: #FAF8F5; border: 1px solid var(--accent-gold); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; color: var(--accent-gold); font-size: 1.5rem;">✓</div>
            <h3 style="font-size: 1.8rem; margin-bottom: 0.75rem;">Enquiry Received</h3>
            <p style="font-size: 1.05rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.5rem; line-height: 1.6;">
              Thank you for your enquiry. We are preparing a response with the available artwork details.
            </p>
            <div style="background: var(--bg-primary); padding: 1rem 1.5rem; border: 1px solid var(--border-subtle); display: inline-block; margin-bottom: 2rem; border-radius: 2px;">
              <span style="font-size: 0.75rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted);">Reference Number:</span>
              <div style="font-family: var(--font-serif); font-size: 1.4rem; color: var(--text-primary); font-weight: 500;">${saved.id}</div>
            </div>
            <div>
              <a href="auth.html" class="btn-primary" style="margin-right: 1rem;">View in My Account</a>
              <button onclick="window.closeInquiryModal(); window.location.reload();" class="btn-secondary">Return to Platform</button>
            </div>
          </div>
        `;
      } catch (err) {
        alert(err.message || 'Could not submit inquiry. Please try again.');
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
      }
    });
  }

  // Visitor Review Form Submission
  const reviewForm = document.getElementById('visitorReviewForm');
  if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = reviewForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Submitting Testimonial...';
      submitBtn.disabled = true;

      const reviewData = {
        authorName: sanitizeHTML(document.getElementById('reviewAuthorName').value.trim()),
        authorEmail: sanitizeHTML(document.getElementById('reviewAuthorEmail').value.trim()),
        authorLocation: sanitizeHTML(document.getElementById('reviewAuthorLocation').value.trim()),
        rating: parseInt(document.getElementById('reviewRatingSelect').value, 10) || 5,
        comment: sanitizeHTML(document.getElementById('reviewComment').value.trim()),
        artworkId: document.getElementById('reviewArtworkId')?.value || null,
        _ts: document.getElementById('reviewTimestamp')?.value || Date.now(),
        website_hp: document.getElementById('reviewHoneypot')?.value || ''
      };

      try {
        await EddyStore.addReview(reviewData);

        const modalBody = document.querySelector('#reviewModal .modal-body');
        if (modalBody) {
          modalBody.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem;">
              <div style="width: 60px; height: 60px; border-radius: 50%; background: #FAF8F5; border: 1px solid var(--accent-gold); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; color: var(--accent-gold); font-size: 1.5rem;">★</div>
              <h3 style="font-size: 1.8rem; margin-bottom: 0.75rem;">Testimonial Received</h3>
              <p style="font-size: 0.95rem; color: var(--text-secondary); max-width: 440px; margin: 0 auto 1.5rem; line-height: 1.6;">
                Thank you, <strong>${reviewData.authorName}</strong>. Your testimonial has been submitted to the curatorial directorate and will appear in our public accolades following curatorial review.
              </p>
              <button onclick="window.closeReviewModal(); window.location.reload();" class="btn-primary">
                Return to Gallery
              </button>
            </div>
          `;
        }
      } catch (err) {
        alert(err.message || 'Could not submit testimonial. Please try again.');
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
      }
    });
  }

  // Accordion triggers
  document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      item.classList.toggle('open');
    });
  });

  // Mobile Navigation Drawer Listeners
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileNavDrawer = document.getElementById('mobileNavDrawer');
  const mobileNavClose = document.getElementById('mobileNavClose');

  if (mobileMenuBtn && mobileNavDrawer) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileNavDrawer.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

  if (mobileNavClose && mobileNavDrawer) {
    mobileNavClose.addEventListener('click', () => {
      mobileNavDrawer.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  // Close mobile drawer when clicking any nav link
  document.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (mobileNavDrawer) {
        mobileNavDrawer.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  });

  // Reactive collector session updates across tabs and views
  window.addEventListener('storage', (e) => {
    if (e.key === 'eddy_collector_session') {
      EddyStore.updateUserNav();
    }
  });
  window.addEventListener('userSessionChanged', () => {
    EddyStore.updateUserNav();
  });
});

// Show / Hide Password Visibility Toggle Helper
window.togglePasswordVisibility = function(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btnEl) btnEl.innerHTML = '🙈 Hide';
  } else {
    input.type = 'password';
    if (btnEl) btnEl.innerHTML = '👁 Show';
  }
};

// Global Visitor Review Modal Handlers
window.openReviewModal = function(artworkId = null, artworkTitle = null) {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  const inArtworkId = document.getElementById('reviewArtworkId');
  if (inArtworkId) inArtworkId.value = artworkId || '';

  const inArtworkTitle = document.getElementById('reviewArtworkTitle');
  if (inArtworkTitle) inArtworkTitle.value = artworkTitle || '';

  const pieceNotice = document.getElementById('reviewPieceNotice');
  if (pieceNotice) {
    if (artworkTitle) {
      pieceNotice.textContent = `Reviewing: "${artworkTitle}"`;
      pieceNotice.style.display = 'block';
    } else {
      pieceNotice.style.display = 'none';
    }
  }

  // Set client time-gate timestamp
  const tsInput = document.getElementById('reviewTimestamp');
  if (tsInput) tsInput.value = Date.now();

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeReviewModal = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

// Render Public Approved Testimonials
window.renderTestimonials = function(containerId = 'testimonialsGrid') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const reviews = EddyStore.reviews || [];
  if (reviews.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <p style="font-family: var(--font-serif); font-size: 1.25rem; font-style: italic; margin-bottom: 1rem;">
          "Every genuine art collection begins with a shared appreciation of form, light, and narrative."
        </p>
        <button onclick="window.openReviewModal()" class="btn-secondary" style="font-size: 0.75rem; padding: 8px 18px;">
          Share Your Collector Testimonial
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = reviews.map(r => {
    const starCount = Math.max(1, Math.min(5, parseInt(r.rating, 10) || 5));
    const stars = '★'.repeat(starCount) + '☆'.repeat(5 - starCount);
    return `
      <div class="testimonial-card">
        <div>
          <div class="testimonial-stars" aria-label="${starCount} out of 5 stars">${stars}</div>
          <div class="testimonial-quote">"${r.comment}"</div>
        </div>
        <div class="testimonial-meta">
          <div>
            <div class="testimonial-author-name">${r.authorName}</div>
            <div class="testimonial-author-location">${r.authorLocation || 'Collector'}</div>
            ${r.artworkTitle ? `<div class="testimonial-artwork-tag">Acquisition: ${r.artworkTitle}</div>` : ''}
          </div>
          <span style="font-size: 0.7rem; color: var(--accent-gold); letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600;">Verified Collector</span>
        </div>
      </div>
    `;
  }).join('');
};

// Auto-render testimonials on page load or reviews loaded event
window.addEventListener('reviewsLoaded', () => {
  if (typeof window.renderTestimonials === 'function') {
    window.renderTestimonials();
  }
});


