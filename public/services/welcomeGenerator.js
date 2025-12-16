const generateWelcomeBookHTML = (data) => {
  const { welcomeBook, rooms, photos, restaurants, places } = data;
  
  return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${welcomeBook.property_name} - Livret d'Accueil | La Conciergerie de Charles</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --primary-orange: #E67E50;
            --dark-bg: #1a1a1a;
            --light-text: #f5f5f5;
            --white: #ffffff;
            --gray: #666666;
            --light-gray: #f8f8f8;
        }

        body {
            font-family: 'Montserrat', sans-serif;
            line-height: 1.6;
            color: var(--dark-bg);
            background: var(--white);
            overflow-x: hidden;
        }

        h1, h2, h3, h4, h5, h6 {
            font-family: 'Cormorant Garamond', serif;
            font-weight: 500;
            letter-spacing: 1px;
        }

        /* Header */
        .header-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: rgba(26, 26, 26, 0.95);
            backdrop-filter: blur(10px);
            padding: 1rem 2rem;
            z-index: 1000;
            box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
        }

        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .logo {
            display: flex;
            flex-direction: column;
            color: var(--white);
        }

        .logo-text {
            font-size: 2rem;
            font-weight: 600;
            letter-spacing: 3px;
        }

        .logo-dots {
            display: flex;
            gap: 4px;
            margin-top: -5px;
        }

        .logo-dots span {
            width: 8px;
            height: 8px;
            background: var(--primary-orange);
            border-radius: 50%;
        }

        .logo-underline {
            height: 2px;
            background: var(--primary-orange);
            margin-top: 2px;
        }

        .header-nav {
            display: flex;
            gap: 2rem;
            align-items: center;
        }

        .header-nav a {
            color: var(--light-text);
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 400;
            letter-spacing: 1px;
            text-transform: uppercase;
            transition: color 0.3s ease;
            position: relative;
        }

        .header-nav a::after {
            content: '';
            position: absolute;
            bottom: -5px;
            left: 0;
            width: 0;
            height: 2px;
            background: var(--primary-orange);
            transition: width 0.3s ease;
        }

        .header-nav a:hover {
            color: var(--primary-orange);
        }

        .header-nav a:hover::after {
            width: 100%;
        }

        /* Hero */
        .hero {
            position: relative;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(rgba(26, 26, 26, 0.5), rgba(26, 26, 26, 0.5)), url('${welcomeBook.cover_photo || ''}');
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            color: var(--white);
            text-align: center;
        }

        .hero-content {
            max-width: 900px;
            padding: 2rem;
            animation: fadeInUp 1.2s ease-out;
        }

        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(40px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .hero-subtitle {
            font-size: 1.2rem;
            color: var(--primary-orange);
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 1rem;
            font-weight: 300;
        }

        .hero h1 {
            font-size: clamp(3rem, 8vw, 6rem);
            margin-bottom: 2rem;
            font-weight: 400;
            line-height: 1.2;
        }

        .hero-description {
            font-size: 1.2rem;
            line-height: 1.8;
            font-weight: 300;
            max-width: 700px;
            margin: 0 auto 3rem;
        }

        .scroll-down {
            position: absolute;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            animation: bounce 2s infinite;
        }

        @keyframes bounce {
            0%, 20%, 50%, 80%, 100% { transform: translateX(-50%) translateY(0); }
            40% { transform: translateX(-50%) translateY(-15px); }
            60% { transform: translateX(-50%) translateY(-8px); }
        }

        .scroll-down i {
            font-size: 2rem;
            color: var(--primary-orange);
        }

        /* Container */
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 6rem 2rem;
        }

        /* Section */
        .section {
            margin-bottom: 6rem;
            opacity: 0;
            transform: translateY(30px);
            transition: opacity 0.8s ease, transform 0.8s ease;
        }

        .section.visible {
            opacity: 1;
            transform: translateY(0);
        }

        .section-header {
            text-align: center;
            margin-bottom: 4rem;
        }

        .section-subtitle {
            font-size: 0.9rem;
            color: var(--primary-orange);
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 1rem;
            font-weight: 500;
        }

        .section-title {
            font-size: clamp(2.5rem, 5vw, 4rem);
            color: var(--dark-bg);
            font-weight: 400;
            margin-bottom: 1rem;
        }

        .section-description {
            font-size: 1.1rem;
            color: var(--gray);
            max-width: 700px;
            margin: 0 auto;
            line-height: 1.8;
        }

        /* Info Cards */
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin: 3rem 0;
        }

        .info-card {
            background: var(--white);
            padding: 3rem 2rem;
            border: 1px solid #e0e0e0;
            transition: all 0.4s ease;
            position: relative;
            overflow: hidden;
        }

        .info-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background: var(--primary-orange);
            transform: scaleX(0);
            transition: transform 0.4s ease;
        }

        .info-card:hover::before {
            transform: scaleX(1);
        }

        .info-card:hover {
            transform: translateY(-10px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }

        .info-card-icon {
            font-size: 2.5rem;
            color: var(--primary-orange);
            margin-bottom: 1.5rem;
        }

        .info-card h3 {
            font-size: 1.5rem;
            color: var(--dark-bg);
            margin-bottom: 1rem;
        }

        .info-card p {
            color: var(--gray);
            line-height: 1.8;
        }

        .info-card strong {
            color: var(--dark-bg);
            font-weight: 600;
        }

        /* Galerie photos */
        .photo-gallery {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 3rem 0;
        }

        .photo-item {
            position: relative;
            overflow: hidden;
            aspect-ratio: 4/3;
            cursor: pointer;
        }

        .photo-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.6s ease;
        }

        .photo-item:hover img {
            transform: scale(1.1);
        }

        .photo-overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 2rem;
            background: linear-gradient(transparent, rgba(26, 26, 26, 0.95));
            transform: translateY(100%);
            transition: transform 0.4s ease;
        }

        .photo-item:hover .photo-overlay {
            transform: translateY(0);
        }

        .photo-overlay h3 {
            color: var(--white);
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
        }

        .photo-overlay p {
            color: var(--light-text);
            font-size: 0.95rem;
        }

        /* Highlight Box */
        .highlight-box {
            background: var(--dark-bg);
            color: var(--white);
            padding: 3rem;
            margin: 3rem 0;
            position: relative;
            overflow: hidden;
        }

        .highlight-box::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 5px;
            height: 100%;
            background: var(--primary-orange);
        }

        .highlight-box h3 {
            color: var(--white);
            font-size: 2rem;
            margin-bottom: 1.5rem;
        }

        .highlight-box p {
            font-size: 1.1rem;
            line-height: 1.8;
        }

        .highlight-box .phone {
            color: var(--primary-orange);
            font-size: 1.5rem;
            font-weight: 600;
            margin-top: 1rem;
            display: inline-block;
        }

        /* Tableau */
        .modern-table {
            width: 100%;
            background: var(--white);
            border: 1px solid #e0e0e0;
            margin: 2rem 0;
            overflow: hidden;
        }

        .modern-table table {
            width: 100%;
            border-collapse: collapse;
        }

        .modern-table th {
            background: var(--dark-bg);
            color: var(--white);
            padding: 1.5rem;
            text-align: left;
            font-weight: 500;
            letter-spacing: 1px;
        }

        .modern-table td {
            padding: 1.5rem;
            border-bottom: 1px solid #e0e0e0;
            color: var(--gray);
        }

        .modern-table tr:last-child td {
            border-bottom: none;
        }

        .modern-table tr:hover td {
            background: var(--light-gray);
        }

        .modern-table .accent {
            color: var(--primary-orange);
            font-weight: 600;
            font-size: 1.1rem;
        }

        /* Liste élégante */
        .elegant-list {
            list-style: none;
            padding: 0;
        }

        .elegant-list li {
            padding: 1rem 0 1rem 2.5rem;
            position: relative;
            border-bottom: 1px solid #e0e0e0;
            transition: padding-left 0.3s ease;
        }

        .elegant-list li:last-child {
            border-bottom: none;
        }

        .elegant-list li::before {
            content: '';
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            width: 6px;
            height: 6px;
            background: var(--primary-orange);
            border-radius: 50%;
            transition: width 0.3s ease;
        }

        .elegant-list li:hover {
            padding-left: 3rem;
        }

        .elegant-list li:hover::before {
            width: 12px;
        }

        /* Warning box */
        .warning-box {
            background: #fff3e0;
            border-left: 4px solid #ff9800;
            padding: 2rem;
            margin: 2rem 0;
            border-radius: 4px;
        }

        .warning-box h4 {
            color: #e65100;
            margin-bottom: 1rem;
            font-size: 1.3rem;
        }

        .warning-box p {
            color: #5d4037;
        }

        /* Footer */
        .footer {
            background: var(--dark-bg);
            color: var(--light-text);
            padding: 4rem 2rem;
            text-align: center;
        }

        .footer h2 {
            font-size: 3rem;
            color: var(--white);
            margin-bottom: 2rem;
        }

        .footer-content {
            max-width: 800px;
            margin: 0 auto;
        }

        .contact-info {
            display: flex;
            justify-content: center;
            gap: 3rem;
            margin: 3rem 0;
            flex-wrap: wrap;
        }

        .contact-item {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .contact-item i {
            font-size: 1.5rem;
            color: var(--primary-orange);
        }

        .footer-logo {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        /* Divider */
        .divider {
            width: 80px;
            height: 3px;
            background: var(--primary-orange);
            margin: 2rem auto;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .hero h1 {
                font-size: 3rem;
            }

            .header-nav {
                display: none;
            }

            .section-title {
                font-size: 2.5rem;
            }

            .info-grid, .photo-gallery {
                grid-template-columns: 1fr;
            }

            .contact-info {
                flex-direction: column;
                gap: 1.5rem;
            }
        }

.header-content {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 2rem;
  /* AJOUTE CETTE LIGNE pour remonter le texte (plus le chiffre est grand, plus ça monte) */
  padding-bottom: 80px; 
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); /* Fond noir dégradé pour aider la lecture */
}

.property-name {
  font-size: 3rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  color: white;
  /* AJOUTE CETTE LIGNE pour l'ombre portée (lisibilité) */
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7); 
}

.property-address {
  color: rgba(255, 255, 255, 0.9);
  font-size: 1.1rem;
  /* AJOUTE CETTE LIGNE aussi */
  text-shadow: 0 2px 5px rgba(0, 0, 0, 0.8);
}
    </style>
</head>
<body>
    <!-- Header -->
    <header class="header-bar">
        <div class="header-content">
            <div class="logo">
                <div class="logo-text">LCC</div>
                <div class="logo-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <div class="logo-underline"></div>
            </div>
            <nav class="header-nav">
                <a href="#arrivee">Arrivée</a>
                <a href="#logement">Logement</a>
                <a href="#pratique">Pratique</a>
                <a href="#alentours">Alentours</a>
            </nav>
        </div>
    </header>

    <!-- Hero -->
    <section class="hero">
        <div class="hero-content">
            <p class="hero-subtitle">Bienvenue</p> 
            
            <h1>${welcomeBook.propertyName || welcomeBook.property_name}</h1>
            
            ${welcomeBook.welcomeDescription ? `
            <p class="hero-description">
                ${welcomeBook.welcomeDescription}
            </p>
            ` : ''}
        </div>
        <div class="scroll-down">
            <i class="fas fa-chevron-down"></i>
        </div>
    </section>

    <!-- Container -->
    <div class="container">
        <!-- Arrivée -->
        <section id="arrivee" class="section">
            <div class="section-header">
                <p class="section-subtitle">Informations pratiques</p>
                <h2 class="section-title">Votre Arrivée</h2>
                <div class="divider"></div>
            </div>

            <div class="highlight-box">
                <h3>La Conciergerie de Charles</h3>
                <p>
                    Votre arrivée dans l'appartement se fait de manière totalement autonome.<br>
                    Vous trouverez toutes les explications ci-dessous.
                </p>
                ${welcomeBook.contact_phone ? `
                <p style="margin-top: 2rem;">Pour toute question, contactez-moi :</p>
                <a href="tel:${welcomeBook.contact_phone}" class="phone">${welcomeBook.contact_phone}</a>
                ` : ''}
            </div>

            <div class="info-grid">
                ${welcomeBook.address ? `
                <div class="info-card">
                    <div class="info-card-icon"><i class="fas fa-map-marker-alt"></i></div>
                    <h3>Adresse</h3>
                    <p>
                        <strong>${welcomeBook.address}</strong><br>
                        ${welcomeBook.postal_code} ${welcomeBook.city}
                    </p>
                </div>
                ` : ''}

                ${welcomeBook.keybox_code ? `
                <div class="info-card">
                    <div class="info-card-icon"><i class="fas fa-key"></i></div>
                    <h3>Boîte à clés</h3>
                    <p>
                        <strong class="accent">CODE : ${welcomeBook.keybox_code}</strong>
                    </p>
                </div>
                ` : ''}

                ${welcomeBook.parking_info ? `
                <div class="info-card">
                    <div class="info-card-icon"><i class="fas fa-parking"></i></div>
                    <h3>Parking</h3>
                    <p>${welcomeBook.parking_info}</p>
                </div>
                ` : ''}
            </div>

            ${welcomeBook.access_instructions ? `
            <div class="info-card" style="margin-top: 2rem;">
                <div class="info-card-icon"><i class="fas fa-info-circle"></i></div>
                <h3>Instructions d'accès</h3>
                <p>${welcomeBook.access_instructions}</p>
            </div>
            ` : ''}

            ${photos.entrance.length > 0 ? `
            <div class="section-header" style="margin-top: 5rem;">
                <p class="section-subtitle">Accès</p>
                <h2 class="section-title">Photos de l'entrée</h2>
                <div class="divider"></div>
            </div>

            <div class="photo-gallery">
                ${photos.entrance.map(photo => `
                <div class="photo-item">
                    <img src="${photo.photo_url}" alt="Entrée">
                    ${photo.caption ? `
                    <div class="photo-overlay">
                        <h3>${photo.caption}</h3>
                    </div>
                    ` : ''}
                </div>
                `).join('')}
            </div>
            ` : ''}

            ${photos.parking.length > 0 ? `
            <div class="section-header" style="margin-top: 4rem;">
                <h3 class="section-title" style="font-size: 2rem;">Parking</h3>
            </div>

            <div class="photo-gallery">
                ${photos.parking.map(photo => `
                <div class="photo-item">
                    <img src="${photo.photo_url}" alt="Parking">
                    ${photo.caption ? `
                    <div class="photo-overlay">
                        <h3>${photo.caption}</h3>
                    </div>
                    ` : ''}
                </div>
                `).join('')}
            </div>
            ` : ''}
        </section>

        <!-- Logement -->
        ${rooms.length > 0 ? `
        <section id="logement" class="section">
            <div class="section-header">
                <p class="section-subtitle">Découvrez</p>
                <h2 class="section-title">Présentation des Lieux</h2>
                <div class="divider"></div>
            </div>

            <div class="photo-gallery">
                ${rooms.map(room => `
                    ${room.photos && room.photos.length > 0 ? room.photos.map(photo => `
                    <div class="photo-item">
                        <img src="${photo.photo_url}" alt="${room.name}">
                        <div class="photo-overlay">
                            <h3>${room.name}</h3>
                            ${room.description ? `<p>${room.description}</p>` : ''}
                        </div>
                    </div>
                    `).join('') : `
                    <div class="info-card">
                        <h3>${room.name}</h3>
                        ${room.description ? `<p>${room.description}</p>` : ''}
                    </div>
                    `}
                `).join('')}
            </div>
        </section>
        ` : ''}

        <!-- Pratique -->
        <section id="pratique" class="section">
            <div class="section-header">
                <p class="section-subtitle">Informations</p>
                <h2 class="section-title">Côté Logement</h2>
                <div class="divider"></div>
            </div>

            ${welcomeBook.wifi_ssid || welcomeBook.wifi_password ? `
            <div class="modern-table">
                <table>
                    <thead>
                        <tr>
                            <th><i class="fas fa-wifi"></i> Réseau Wi-Fi</th>
                            <th><i class="fas fa-lock"></i> Mot de passe</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="accent">${welcomeBook.wifi_ssid || '-'}</td>
                            <td><code style="font-family: monospace; color: var(--dark-bg); font-weight: 600;">${welcomeBook.wifi_password || '-'}</code></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            ` : ''}

            ${welcomeBook.important_rules ? `
            <div class="warning-box">
                <h4><i class="fas fa-exclamation-triangle"></i> Règles importantes</h4>
                <p>${welcomeBook.important_rules.replace(/\n/g, '<br>')}</p>
            </div>
            ` : ''}

            ${welcomeBook.checkout_time || welcomeBook.checkout_instructions ? `
            <div class="section-header" style="margin-top: 4rem;">
                <h3 class="section-title" style="font-size: 2rem;">Avant votre départ${welcomeBook.checkout_time ? ` (${welcomeBook.checkout_time})` : ''}</h3>
            </div>

            ${welcomeBook.checkout_instructions ? `
            <ul class="elegant-list">
                ${welcomeBook.checkout_instructions.split('\n').filter(line => line.trim()).map(line => `
                <li>${line.replace(/^[-•]\s*/, '')}</li>
                `).join('')}
            </ul>
            ` : ''}
            ` : ''}

            ${welcomeBook.equipment_list ? `
            <div class="section-header" style="margin-top: 4rem;">
                <h3 class="section-title" style="font-size: 2rem;">Équipements</h3>
            </div>

            <ul class="elegant-list">
                ${welcomeBook.equipment_list.split('\n').filter(line => line.trim()).map(line => `
                <li>${line.replace(/^[-•]\s*/, '')}</li>
                `).join('')}
            </ul>
            ` : ''}

            ${welcomeBook.transport_info ? `
            <div class="section-header" style="margin-top: 4rem;">
                <h3 class="section-title" style="font-size: 2rem;"><i class="fas fa-train"></i> Transport</h3>
            </div>

            <div class="highlight-box" style="background: linear-gradient(135deg, #1e3a5f 0%, #2c5f7c 100%);">
                <h3>Transports en commun</h3>
                <p>${welcomeBook.transport_info.replace(/\n/g, '<br>')}</p>
            </div>
            ` : ''}
        </section>

        <!-- Alentours -->
        ${restaurants.length > 0 || places.length > 0 || welcomeBook.shops_list ? `
        <section id="alentours" class="section">
            <div class="section-header">
                <p class="section-subtitle">Explorer</p>
                <h2 class="section-title">Aux Alentours</h2>
                <div class="divider"></div>
            </div>

            ${restaurants.length > 0 ? `
            <h3 style="margin-bottom: 2rem; color: var(--gray-700); font-size: 2rem;">
                <i class="fas fa-utensils" style="color: var(--primary-orange);"></i> Restaurants & Bars
            </h3>

            <div class="info-grid">
                ${restaurants.map(restaurant => `
                <div class="info-card">
                    <div class="info-card-icon"><i class="fas fa-wine-glass"></i></div>
                    <h3>${restaurant.name}</h3>
                    <p>
                        ${restaurant.address ? `<strong>${restaurant.address}</strong>` : ''}
                        ${restaurant.phone ? `${restaurant.address ? ' • ' : ''}<strong>${restaurant.phone}</strong>` : ''}<br>
                        ${restaurant.description || ''}
                    </p>
                </div>
                `).join('')}
            </div>
            ` : ''}

            ${welcomeBook.shops_list ? `
            <div class="section-header" style="margin-top: 5rem;">
                <h3 class="section-title" style="font-size: 2.5rem;">Commerces</h3>
            </div>

            <ul class="elegant-list">
                ${welcomeBook.shops_list.split('\n').filter(line => line.trim()).map(line => `
                <li>${line.replace(/^[-•]\s*/, '')}</li>
                `).join('')}
            </ul>
            ` : ''}

            ${places.length > 0 ? `
            <div class="section-header" style="margin-top: 5rem;">
                <h3 class="section-title" style="font-size: 2.5rem;">À Visiter</h3>
            </div>

            <div class="photo-gallery">
                ${places.map(place => `
                <div class="photo-item">
                    ${place.photo_url ? `
                    <img src="${place.photo_url}" alt="${place.name}">
                    <div class="photo-overlay">
                        <h3>${place.name}</h3>
                        ${place.description ? `<p>${place.description}</p>` : ''}
                    </div>
                    ` : `
                    <div class="info-card">
                        <h3>${place.name}</h3>
                        ${place.description ? `<p>${place.description}</p>` : ''}
                    </div>
                    `}
                </div>
                `).join('')}
            </div>
            ` : ''}
        </section>
        ` : ''}
    </div>

    <!-- Footer -->
    <footer class="footer">
        <div class="footer-content">
            <h2>Nous Espérons que Vous Passerez un Excellent Séjour</h2>
            <p style="font-size: 1.1rem; line-height: 1.8; margin: 2rem 0;">
                Nous serions heureux de connaître votre avis sur votre séjour.<br>
                Votre retour est précieux et nous permettra d'améliorer ce logement.
            </p>

            ${welcomeBook.contact_phone ? `
            <div class="contact-info">
                <div class="contact-item">
                    <i class="fas fa-phone-alt"></i>
                    <div>
                        <strong>Téléphone</strong><br>
                        ${welcomeBook.contact_phone}
                    </div>
                </div>

                <div class="contact-item">
                    <i class="fas fa-concierge-bell"></i>
                    <div>
                        <strong>La Conciergerie de Charles</strong><br>
                        À votre service
                    </div>
                </div>
            </div>
            ` : ''}

            <div class="footer-logo">
                <div class="logo">
                    <div class="logo-text">LCC</div>
                    <div class="logo-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    <div class="logo-underline"></div>
                </div>
                <p style="margin-top: 1rem; opacity: 0.7; font-size: 0.9rem;">
                    © 2024 La Conciergerie de Charles
                </p>
            </div>
        </div>
    </footer>

    <script>
        // Smooth scroll
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    const headerOffset = 80;
                    const elementPosition = target.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });

        // Intersection Observer
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, observerOptions);

        document.querySelectorAll('.section').forEach(section => {
            observer.observe(section);
        });

        // Parallax hero
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const hero = document.querySelector('.hero');
            if (hero && scrolled < window.innerHeight) {
                hero.style.transform = \`translateY(\${scrolled * 0.5}px)\`;
            }
        });
    </script>
</body>
</html>`;
};

module.exports = { generateWelcomeBookHTML };
