'use strict';

// Design tokens — sourced from public/css/bh-tokens.css
const T = {
  // Brand greens
  vert900: '#0A2C22',  // header bg
  vert800: '#0E3B2E',  // primary action / CTA bg
  vert600: '#1E6E52',  // accent

  // Neutral surfaces
  fondCreme:  '#F4F1E9',  // outer email bg
  ivoire:     '#F2EADA',  // subtle surface
  card:       '#F5F2EC',  // card bg
  fondPage:   '#FBFBFA',  // white-ish card

  // Text
  encre:   '#20221F',  // primary text
  t2:      '#5A5A54',  // secondary
  t3:      '#6A6A64',  // muted
  t4:      '#878782',  // hint

  // Borders
  ligne:   '#EAE9E5',  // card border
  cardBorder: '#DDD9CF',

  // Semantic
  terra:      '#B4470F',  // danger only (payment failed, rejection)
  terraDoux:  '#F7EDE6',  // danger bg
  successBg:  '#F0FAF5',  // success card bg

  // CTA text
  ctaText: '#FFFFFF',

  // Footer
  footerBg:   '#0A2C22',
  footerText: '#A8C4B8',
};

module.exports = T;
