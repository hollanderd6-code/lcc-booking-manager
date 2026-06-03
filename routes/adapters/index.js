const IgloohomeAdapter = require('./igloohome-adapter');
const NukiAdapter = require('./nuki-adapter');
const TTLockAdapter = require('./ttlock-adapter');

const BRANDS = {
  igloohome: {
    Adapter: IgloohomeAdapter,
    label: 'Igloohome',
    icon: '🏠',
    connectFields: [
      { key: 'clientId', label: 'API ID (Client ID)', placeholder: 'Depuis developer.igloocompany.co' },
      { key: 'clientSecret', label: 'API Secret', placeholder: 'Client Secret', type: 'password' },
    ],
    helpUrl: 'https://developer.igloocompany.co',
    helpText: 'Créez un compte développeur sur igloocompany.co, puis copiez le Client ID et Secret.',
  },
  nuki: {
    Adapter: NukiAdapter,
    label: 'Nuki',
    icon: '🔐',
    connectFields: [
      { key: 'apiToken', label: 'API Token', placeholder: 'Depuis web.nuki.io → API', type: 'password' },
    ],
    helpUrl: 'https://web.nuki.io',
    helpText: 'Dans web.nuki.io, allez dans API et générez un nouveau token.',
  },
  ttlock: {
    Adapter: TTLockAdapter,
    label: 'TTLock',
    icon: '🔑',
    connectFields: [
      { key: 'clientId', label: 'App ID', placeholder: 'Depuis open.ttlock.com' },
      { key: 'clientSecret', label: 'App Secret', placeholder: 'App Secret', type: 'password' },
      { key: 'username', label: 'Compte TTLock (email)', placeholder: 'Email du compte TTLock' },
      { key: 'password', label: 'Mot de passe TTLock', placeholder: 'Mot de passe', type: 'password' },
      { key: 'region', label: 'Région', placeholder: 'eu', default: 'eu' },
    ],
    helpUrl: 'https://open.ttlock.com',
    helpText: 'Inscrivez-vous sur open.ttlock.com pour obtenir un App ID et Secret. Utilisez vos identifiants TTLock app.',
  },
};

const SUPPORTED_BRANDS = Object.keys(BRANDS);

function getAdapter(connection, pool) {
  const brand = connection.brand;
  const config = BRANDS[brand];
  if (!config) throw new Error(`Marque non supportée: ${brand}`);
  return new config.Adapter(connection, pool);
}

function getBrandConfig(brand) {
  return BRANDS[brand] || null;
}

module.exports = { getAdapter, getBrandConfig, BRANDS, SUPPORTED_BRANDS };
