/* Shared CSV envelope. The file kind and publishing batch are authenticated. */
const TournamentCrypto = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function decode(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Base64URL");
    const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    if (encode(bytes) !== value) throw new Error("Invalid Base64URL");
    return bytes;
  }
  async function importKey(secret) {
    const raw = decode(secret);
    if (raw.length !== 32) throw new Error("Invalid key length");
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  function context(kind, batch, expires, schedule) {
    return encoder.encode(JSON.stringify(["NASTI1", 1, kind, batch, expires, schedule]));
  }
  async function seal(key, kind, batch, expires, csv, schedule = "") {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = context(kind, batch, expires, schedule);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, encoder.encode(csv));
    return JSON.stringify({ version: 1, kind, batch, expires, schedule, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
  }
  async function open(key, input, kind) {
    const { version, kind: fileKind, batch, expires, schedule, iv, ciphertext } = JSON.parse(input);
    if (version !== 1 || fileKind !== kind || typeof batch !== "string" || !batch ||
        !Number.isSafeInteger(expires) || typeof schedule !== "string") throw new Error("Invalid encrypted CSV");
    const nonce = decode(iv);
    if (nonce.length !== 12) throw new Error("Invalid encrypted CSV nonce");
    const additionalData = context(kind, batch, expires, schedule);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData }, key, decode(ciphertext));
    return { csv: decoder.decode(bytes), batch, expires, schedule };
  }
  async function fingerprint(value) {
    return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
  }
  return { importKey, seal, open, fingerprint };
})();
