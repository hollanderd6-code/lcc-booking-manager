/* ============================================================================
   bh-guest-mark.js — logo BHGuest vectoriel, disponible partout.

   window.bhGuestMark(taille, couleur, encre)
     taille  : largeur en px (la hauteur suit, ratio 0.845)
     couleur : couleur de la goutte     (defaut terracotta)
     encre   : couleur du b et du creux (defaut blanc)

   Sur fond terracotta, inverser : bhGuestMark(13, '#fff', '#B4470F').

   Le viewBox est recadre au plus juste sur le dessin (150..780 x 247..777) :
   dans un carre 0 0 1024 1024, la goutte n'occupait que 61 % de la largeur et
   le logo paraissait deux fois trop petit a taille demandee.
   ============================================================================ */
window.bhGuestMark = window.bhGuestMark || function (taille, couleur, encre) {
  taille = taille || 16;
  couleur = couleur || '#B4470F';
  encre = encre || '#fff';
  var h = Math.round(taille * 0.845);
  return '<svg viewBox="144 241 642 542" width="' + taille + '" height="' + h +
    '" style="display:block;flex-shrink:0" aria-label="BHGuest" role="img">' +
      '<path d="M150 512 L322 330 A265 265 0 1 1 322 694 Z" fill="' + couleur + '"/>' +
      '<path d="M418 350 h74 v20 h-26 v240 h-48 Z" fill="' + encre + '"/>' +
      '<ellipse cx="524" cy="522" rx="70" ry="76" fill="none" stroke="' + encre + '" stroke-width="60"/>' +
      '<ellipse cx="524" cy="522" rx="40" ry="46" fill="' + couleur + '"/>' +
    '</svg>';
};
