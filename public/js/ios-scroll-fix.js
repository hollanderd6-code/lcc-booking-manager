// Fix scroll iOS pour app Capacitor
if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  console.log('🔒 iOS Scroll Fix activé');
  
  // Forcer le blocage du body
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.style.position = 'fixed';
  document.documentElement.style.width = '100%';
  document.documentElement.style.height = '100vh';
  
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.height = '100vh';
}
