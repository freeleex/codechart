const SECRET_NAME = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519).*|\.npmrc|\.netrc|\.pypirc|.*credentials.*)$/i;
const ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i;
export const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

export const looksSecret = (rel: string) => {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return SECRET_NAME.test(name) && !ENV_TEMPLATE.test(name);
};
