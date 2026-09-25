export const cryptoService = {
  _base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    if (!base64) {
      throw new Error("Base64 data is empty.");
    }

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  },

  _uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  },

  async generateKeyPair(): Promise<CryptoKeyPair> {
    return await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"]
    );
  },

  async exportPublicKey(publicKey: CryptoKey): Promise<string> {
    if (publicKey.algorithm.name !== "ECDH") {
      throw new Error("Public key must be an ECDH key.");
    }

    const exported = await window.crypto.subtle.exportKey("jwk", publicKey);

    return JSON.stringify(exported);
  },

  async importPublicKey(jwkString: string): Promise<CryptoKey> {
    if (!jwkString) {
      throw new Error("Public key not found.");
    }

    let jwk: JsonWebKey;

    try {
      jwk = JSON.parse(jwkString);
    } catch {
      throw new Error("Public key is not a valid JWK JSON.");
    }

    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
      throw new Error("Invalid P-256 ECDH public key.");
    }

    return await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      []
    );
  },

  async generateGroupKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
  },

  async encryptMessage(
    groupKey: CryptoKey,
    plaintext: string
  ): Promise<{ cipherText: string; iv: string }> {
    if (!groupKey) {
      throw new Error("Group key not found.");
    }

    if (!plaintext) {
      throw new Error("Plaintext cannot be empty.");
    }

    const encoder = new TextEncoder();
    const encodedData = encoder.encode(plaintext);

    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
      },
      groupKey,
      encodedData
    );

    return {
      cipherText: this._uint8ArrayToBase64(new Uint8Array(encryptedBuffer)),
      iv: this._uint8ArrayToBase64(iv),
    };
  },

  async decryptMessage(
    groupKey: CryptoKey,
    cipherTextBase64: string,
    ivBase64: string
  ): Promise<string> {
    if (!groupKey) {
      throw new Error("Group key not found.");
    }

    if (!cipherTextBase64) {
      throw new Error("Encrypted message not found.");
    }

    if (!ivBase64) {
      throw new Error("IV not found.");
    }

    const decoder = new TextDecoder();
    const cipherBytes = this._base64ToUint8Array(cipherTextBase64);
    const iv = this._base64ToUint8Array(ivBase64);

    if (iv.length !== 12) {
      throw new Error("Invalid AES-GCM IV length.");
    }

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
      },
      groupKey,
      cipherBytes
    );

    return decoder.decode(decryptedBuffer);
  },

  _withKeyStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = indexedDB.open("E2EE_SecureDB", 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains("keys")) {
          db.createObjectStore("keys");
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (mode === "readonly" && !db.objectStoreNames.contains("keys")) {
          db.close();
          resolve(null as unknown as T);
          return;
        }

        let transaction: IDBTransaction;

        try {
          transaction = db.transaction("keys", mode);
        } catch (error) {
          db.close();
          reject(error);
          return;
        }

        const store = transaction.objectStore("keys");
        const req = fn(store);

        req.onsuccess = () => {
          db.close();
          resolve((req.result ?? null) as T);
        };

        req.onerror = () => {
          const error = req.error;
          db.close();
          reject(error);
        };

        transaction.onerror = () => {
          const error = transaction.error;
          db.close();
          reject(error);
        };

        transaction.onabort = () => {
          const error = transaction.error;
          db.close();
          reject(error || new Error("IndexedDB transaction aborted."));
        };
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  },

  async savePrivateKey(privateKey: CryptoKey): Promise<void> {
    if (!privateKey) {
      throw new Error("Private key not found.");
    }

    await this._withKeyStore<void>("readwrite", (store) =>
      store.put(privateKey, "user_private_key")
    );
  },

  async getPrivateKey(): Promise<CryptoKey | null> {
    return await this._withKeyStore<CryptoKey | null>("readonly", (store) =>
      store.get("user_private_key")
    );
  },

  async _deriveSharedKey(
    myPrivateKey: CryptoKey,
    peerPublicKey: CryptoKey
  ): Promise<CryptoKey> {
    if (myPrivateKey.algorithm.name !== "ECDH") {
      throw new Error("Private key must be an ECDH key.");
    }

    if (peerPublicKey.algorithm.name !== "ECDH") {
      throw new Error("Peer public key must be an ECDH key.");
    }

    return await window.crypto.subtle.deriveKey(
      {
        name: "ECDH",
        public: peerPublicKey,
      },
      myPrivateKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
  },

  async encryptGroupKeyForMember(
    myPrivateKey: CryptoKey,
    memberPublicKey: CryptoKey,
    groupKey: CryptoKey
  ): Promise<{ encryptedKey: string; iv: string }> {
    const sharedKey = await this._deriveSharedKey(myPrivateKey, memberPublicKey);
    const rawGroupKey = await window.crypto.subtle.exportKey("raw", groupKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
      },
      sharedKey,
      rawGroupKey
    );

    return {
      encryptedKey: this._uint8ArrayToBase64(new Uint8Array(encryptedBuffer)),
      iv: this._uint8ArrayToBase64(iv),
    };
  },

  async decryptGroupKey(
    myPrivateKey: CryptoKey,
    senderPublicKey: CryptoKey,
    encryptedKeyBase64: string,
    ivBase64: string
  ): Promise<CryptoKey> {
    const sharedKey = await this._deriveSharedKey(myPrivateKey, senderPublicKey);
    const cipherBytes = this._base64ToUint8Array(encryptedKeyBase64);
    const iv = this._base64ToUint8Array(ivBase64);

    if (iv.length !== 12) {
      throw new Error("Invalid AES-GCM IV length.");
    }

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
      },
      sharedKey,
      cipherBytes
    );

    return await window.crypto.subtle.importKey(
      "raw",
      decryptedBuffer,
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
  },
};

export default cryptoService;