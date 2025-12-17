// ROUTE PROPRE POUR /welcome/:uniqueId
// À COPIER dans server-23.js en remplaçant la route existante (ligne ~7440 à ~7767)

app.get('/welcome/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    
    // 1. Récupération des données
    const result = await pool.query(
      `SELECT data FROM public.welcome_books_v2 WHERE unique_id = $1`, 
      [uniqueId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send("<h1>Livret introuvable</h1>");
    }
    
    const d = result.rows[0].data || {};

    // 2. Préparation des variables
    const title = d.propertyName || "Mon Livret d'Accueil";
    const coverPhoto = (d.photos && d.photos.cover) ? d.photos.cover : 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=2070&auto=format&fit=crop';
    
    // 3. Génération du HTML
    const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root {
          --primary: #2563eb;
          --text: #1e293b;
          --bg: #f8fafc;
          --card: #ffffff;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          background: var(--bg);
          color: var(--text);
          line-height: 1.6;
          padding-bottom: 4rem;
        }

        .hero {
          position: relative;
          height: 60vh;
          min-height: 400px;
          background-image: url('${coverPhoto}');
          background-size: cover;
          background-position: center;
        }
        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.7));
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 2rem;
          padding-bottom: 5rem;
        }
        .hero-content {
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
          color: white;
        }
        .hero h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .hero p {
          font-size: 1.1rem;
          opacity: 0.9;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        .container {
          max-width: 800px;
          margin: -4rem auto 0;
          padding: 0 1rem;
          position: relative;
          z-index: 10;
        }

        .card {
          background: var(--card);
          border-radius: 16px;
          padding: 2rem 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
          border: 1px solid rgba(0,0,0,0.05);
        }
        
        .card:first-of-type {
          margin-top: 0.5rem;
        }
        
        .section-title {
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--primary);
        }

        .key-info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }
        .info-item {
          background: #eff6ff;
          padding: 1rem;
          border-radius: 12px;
        }
        .info-label { font-size: 0.85rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .info-value { font-size: 1.1rem; font-weight: 700; color: #1e293b; margin-top: 0.25rem; }
        
        .wifi-card {
          background: #1e293b;
          color: white;
          text-align: center;
          padding: 2rem;
        }
        .wifi-icon { font-size: 2rem; margin-bottom: 1rem; color: #60a5fa; }
        .wifi-ssid { font-size: 1.2rem; margin-bottom: 0.5rem; }
        .wifi-pass { font-family: monospace; font-size: 1.4rem; background: rgba(255,255,255,0.1); padding: 0.5rem 1rem; border-radius: 8px; display: inline-block; }

        .list-item {
          border-bottom: 1px solid #f1f5f9;
          padding: 1rem 0;
        }
        .list-item:last-child { border-bottom: none; }
        .item-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
        .item-title { font-weight: 700; font-size: 1.1rem; }
        .item-meta { font-size: 0.9rem; color: #64748b; }
        .item-desc { color: #475569; font-size: 0.95rem; }

        .gallery {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .gallery img {
          width: 100%;
          height: 120px;
          object-fit: cover;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .gallery img:hover { transform: scale(1.02); }

        .footer {
          text-align: center;
          color: #94a3b8;
          font-size: 0.9rem;
          margin-top: 3rem;
        }
        
        .fab {
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          background: #25d366;
          color: white;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
          text-decoration: none;
          z-index: 100;
          transition: transform 0.2s;
        }
        .fab:hover { transform: scale(1.1); }
      </style>
    </head>
    <body>

      <div class="hero">
        <div class="hero-overlay">
          <div class="hero-content">
            <h1>${title}</h1>
            <p><i class="fas fa-map-marker-alt"></i> ${d.address || ''} ${d.postalCode || ''} ${d.city || ''}</p>
          </div>
        </div>
      </div>

      <div class="container">
      
        <div class="card">
          <div class="section-title"><i class="fas fa-hand-sparkles"></i> Bienvenue</div>
          <p>${(d.welcomeDescription || 'Bienvenue chez nous ! Passez un excellent séjour.').replace(/\n/g, '<br>')}</p>
        </div>

        <div class="key-info-grid">
          <div class="info-item">
            <div class="info-label">Arrivée</div>
            <div class="info-value">${d.accessInstructions ? 'Voir instructions' : 'Dès 15h'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Départ</div>
            <div class="info-value">Avant ${d.checkoutTime || '11h00'}</div>
          </div>
          ${d.keyboxCode ? `
          <div class="info-item">
            <div class="info-label">Boîte à clés</div>
            <div class="info-value">${d.keyboxCode}</div>
          </div>` : ''}
        </div>

        <br>

        ${d.wifiSSID ? `
        <div class="card wifi-card">
          <div class="wifi-icon"><i class="fas fa-wifi"></i></div>
          <div class="wifi-ssid">${d.wifiSSID}</div>
          <div class="wifi-pass">${d.wifiPassword || 'Pas de mot de passe'}</div>
        </div>` : ''}

        ${d.accessInstructions ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-key"></i> Accès au logement</div>
          <p>${d.accessInstructions.replace(/\n/g, '<br>')}</p>
          ${d.photos && d.photos.entrance && d.photos.entrance.length > 0 ? `
            <div class="gallery">
              ${d.photos.entrance.map(url => `<img src="${url}" onclick="window.open(this.src)" alt="Entrée">`).join('')}
            </div>
          ` : ''}
        </div>` : ''}

        ${d.parkingInfo ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-parking"></i> Parking</div>
          <p>${d.parkingInfo.replace(/\n/g, '<br>')}</p>
          ${d.photos && d.photos.parking && d.photos.parking.length > 0 ? `
            <div class="gallery">
              ${d.photos.parking.map(url => `<img src="${url}" onclick="window.open(this.src)" alt="Parking">`).join('')}
            </div>
          ` : ''}
        </div>` : ''}

        ${d.rooms && d.rooms.length > 0 ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-bed"></i> Le Logement</div>
          ${d.rooms.map((room, i) => `
            <div class="list-item">
              <div class="item-header">
                <div class="item-title">${room.name || 'Pièce ' + (i+1)}</div>
              </div>
              ${room.description ? `<p class="item-desc">${room.description}</p>` : ''}
            </div>
          `).join('')}
          
          ${d.photos && d.photos.roomPhotos && d.photos.roomPhotos.length > 0 ? `
            <div class="gallery" style="margin-top:1rem; border-top:1px dashed #e2e8f0; padding-top:1rem;">
               ${d.photos.roomPhotos.map(url => `<img src="${url}" onclick="window.open(this.src)" alt="Photo">`).join('')}
            </div>
          ` : ''}
        </div>` : ''}

        ${d.importantRules || d.checkoutInstructions ? `
        <div class="card">
           <div class="section-title"><i class="fas fa-clipboard-check"></i> Règles & Départ</div>
           ${d.importantRules ? `<p><strong>À savoir :</strong><br>${d.importantRules.replace(/\n/g, '<br>')}</p><br>` : ''}
           ${d.checkoutInstructions ? `<p><strong>Au départ :</strong><br>${d.checkoutInstructions.replace(/\n/g, '<br>')}</p>` : ''}
        </div>` : ''}

        ${d.equipmentList ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-toolbox"></i> Équipements</div>
          <ul style="padding-left: 1.5rem; color: #475569;">
            ${d.equipmentList.split('\n').filter(e => e.trim()).map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${d.transportInfo ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-train"></i> Transports</div>
          <p>${d.transportInfo.replace(/\n/g, '<br>')}</p>
        </div>` : ''}

        ${(d.restaurants && d.restaurants.length > 0) || (d.places && d.places.length > 0) || d.shopsList ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-map-signs"></i> Guide Local</div>
          
          ${d.restaurants && d.restaurants.length > 0 ? `
            <h4 style="margin:1rem 0 0.5rem 0; color:#64748b;">🍽️ Restaurants</h4>
            ${d.restaurants.map(resto => `
              <div class="list-item">
                <div class="item-header">
                  <div class="item-title">${resto.name}</div>
                  ${resto.phone ? `<div class="item-meta">${resto.phone}</div>` : ''}
                </div>
                ${resto.description ? `<p class="item-desc">${resto.description}</p>` : ''}
                ${resto.address ? `<small style="color:#94a3b8"><i class="fas fa-location-arrow"></i> ${resto.address}</small>` : ''}
              </div>
            `).join('')}
          ` : ''}

          ${d.shopsList ? `
            <h4 style="margin:1.5rem 0 0.5rem 0; color:#64748b;">🛒 Commerces</h4>
            <ul style="padding-left: 1.5rem; color: #475569;">
              ${d.shopsList.split('\n').filter(s => s.trim()).map(shop => `<li>${shop}</li>`).join('')}
            </ul>
          ` : ''}

          ${d.places && d.places.length > 0 ? `
            <h4 style="margin:1.5rem 0 0.5rem 0; color:#64748b;">🗺️ À visiter</h4>
            ${d.places.map(place => `
              <div class="list-item">
                <div class="item-title">${place.name}</div>
                ${place.description ? `<p class="item-desc">${place.description}</p>` : ''}
              </div>
            `).join('')}
            
            ${d.photos && d.photos.placePhotos && d.photos.placePhotos.length > 0 ? `
              <div class="gallery" style="margin-top:1rem;">
                 ${d.photos.placePhotos.map(url => `<img src="${url}" onclick="window.open(this.src)" alt="Lieu">`).join('')}
              </div>
            ` : ''}
          ` : ''}
        </div>` : ''}

        <div class="footer">
          <p>Livret propulsé par BoostingHost</p>
        </div>

      </div>

      ${d.contactPhone ? `
      <a href="tel:${d.contactPhone}" class="fab" title="Contacter l'hôte">
        <i class="fas fa-phone"></i>
      </a>` : ''}

    </body>
    </html>
    `;
    
    // Envoyer avec le bon header UTF-8
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (error) {
    console.error('Erreur affichage livret:', error);
    res.status(500).send('Erreur lors de l\'affichage du livret');
  }
});
