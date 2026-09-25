import { cryptoService } from "./cryptoService";

type Member = {
  id: number;
  publicKey: string;
};

type KeyPacket = {
  groupId: number;
  userId: number;
  keyVersion: number;
  encryptedGroupKey: string;
  iv: string;
  senderPublicKey: string;
};

type GroupKeyPacket = {
  groupId?: number;
  keyVersion: number;
  encryptedGroupKey: string;
  iv: string;
  senderPublicKey: string;
};

export const cryptoHandler = {
  async createAndDistributeKeys(
    groupId: number,
    keyVersion: number,
    members: Member[],
    saveMutation: (input: KeyPacket) => Promise<void>
  ): Promise<void> {
    if (!Number.isInteger(groupId) || groupId < 1) {
      throw new Error(`Invalid group id: ${groupId}`);
    }

    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      throw new Error(`Invalid key version: ${keyVersion}`);
    }

    if (!members.length) {
      throw new Error("Group has no members.");
    }

    const groupKey = await cryptoService.generateGroupKey();
    const myPrivateKey = await cryptoService.getPrivateKey();

    if (!myPrivateKey) {
      throw new Error("Private key not found. Please log in again.");
    }

    const myPublicKey = await this.getPublicKeyFromPrivate(myPrivateKey);
    const exportedPublicKey = await window.crypto.subtle.exportKey("jwk", myPublicKey);
    const senderPublicKey = JSON.stringify(exportedPublicKey);

    await Promise.all(
      members.map(async (member) => {
        if (!Number.isInteger(member.id) || member.id < 1) {
          throw new Error(`Invalid member id: ${member.id}`);
        }

        if (!member.publicKey) {
          throw new Error(`User @${member.id} has no public key.`);
        }

        const memberPublicKey = await cryptoService.importPublicKey(member.publicKey);

        const { encryptedKey, iv } = await cryptoService.encryptGroupKeyForMember(
          myPrivateKey,
          memberPublicKey,
          groupKey
        );

        const packet: KeyPacket = {
          groupId,
          userId: member.id,
          keyVersion,
          encryptedGroupKey: encryptedKey,
          iv,
          senderPublicKey,
        };

        await saveMutation(packet);
      })
    );
  },

  async getPublicKeyFromPrivate(privateKey: CryptoKey): Promise<CryptoKey> {
    if (privateKey.algorithm.name !== "ECDH") {
      throw new Error(`Invalid private key algorithm: ${privateKey.algorithm.name}`);
    }

    const privateJwk = await window.crypto.subtle.exportKey("jwk", privateKey);

    if (
      privateJwk.kty !== "EC" ||
      privateJwk.crv !== "P-256" ||
      !privateJwk.x ||
      !privateJwk.y
    ) {
      throw new Error("Private JWK does not contain valid P-256 ECDH public key coordinates.");
    }

    return await window.crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: privateJwk.x,
        y: privateJwk.y,
        ext: true,
      },
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      []
    );
  },

  async loadGroupKey(
    groupId: number,
    keyVersion: number,
    fetchGroupKeyApi: (
      groupId: number,
      keyVersion: number
    ) => Promise<GroupKeyPacket | null>
  ): Promise<CryptoKey> {
    if (!Number.isInteger(groupId) || groupId < 1) {
      throw new Error(`Invalid group id: ${groupId}`);
    }

    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      throw new Error(`Invalid key version: ${keyVersion}`);
    }

    const packet = await fetchGroupKeyApi(groupId, keyVersion);

    if (!packet) {
      throw new Error(`Group key not found for group ${groupId}, version ${keyVersion}.`);
    }

    if (packet.groupId !== undefined && packet.groupId !== groupId) {
      throw new Error("Group key packet group ID mismatch.");
    }

    if (packet.keyVersion !== keyVersion) {
      throw new Error(
        `Key version mismatch. Expected ${keyVersion}, received ${packet.keyVersion}.`
      );
    }

    if (!packet.encryptedGroupKey || !packet.iv || !packet.senderPublicKey) {
      throw new Error("Invalid group key packet structure.");
    }

    const myPrivateKey = await cryptoService.getPrivateKey();

    if (!myPrivateKey) {
      throw new Error("Private key not found. Please log in again.");
    }

    const senderPublicKey = await cryptoService.importPublicKey(packet.senderPublicKey);

    return await cryptoService.decryptGroupKey(
      myPrivateKey,
      senderPublicKey,
      packet.encryptedGroupKey,
      packet.iv
    );
  },

  async encryptAndSend(
    groupKey: CryptoKey,
    content: string,
    keyVersion: number,
    sendFunction: (payload: {
      encryptedContent: string;
      iv: string;
      keyVersion: number;
    }) => Promise<void>
  ): Promise<void> {
    if (!groupKey) {
      throw new Error("Group key not found.");
    }

    if (!content) {
      throw new Error("Message content cannot be empty.");
    }

    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      throw new Error(`Invalid key version: ${keyVersion}`);
    }

    const { cipherText, iv } = await cryptoService.encryptMessage(groupKey, content);

    await sendFunction({
      encryptedContent: cipherText,
      iv,
      keyVersion,
    });
  },

  async decryptMessage(
    groupKey: CryptoKey,
    encryptedContent: string,
    iv: string
  ): Promise<string> {
    if (!groupKey) {
      throw new Error("Group key not found.");
    }

    if (!encryptedContent) {
      throw new Error("Encrypted content not found.");
    }

    if (!iv) {
      throw new Error("IV not found.");
    }

    return await cryptoService.decryptMessage(groupKey, encryptedContent, iv);
  },
};

export default cryptoHandler;