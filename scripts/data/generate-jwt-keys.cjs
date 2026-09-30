// scripts/generate-jwt-keys.cjs — генерация RS256 ключей для JWT_PRIVATE_KEY/JWT_PUBLIC_KEY
// в формате .env (escape \n). Запуск: node scripts/generate-jwt-keys.cjs
const c = require('crypto')
const { privateKey, publicKey } = c.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const escape = (s) => s.replace(/\n/g, '\\n').replace(/"/g, '\\"')
console.log('JWT_PRIVATE_KEY="' + escape(privateKey) + '"')
console.log('JWT_PUBLIC_KEY="' + escape(publicKey) + '"')
console.log('JWT_KID=v1')
