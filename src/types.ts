export interface User {
  id: string;
  username: string;
  publicKey?: string | null;
}

export interface ChatGroup {
  id: string;
  name: string;
  keyVersion: number;
  createdAt?: string | null;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: string;
  joinedAt?: string | null;
}

export interface GroupKey {
  id: string;
  groupId: string;
  userId: string;
  keyVersion: number;
  encryptedGroupKey: string;
  iv: string;
  senderPublicKey: string; 
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  groupId: string;
  encryptedContent: string;
  iv: string;
  keyVersion: number;
  createdAt?: string | null;
  content?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface RegisterUserInput {
  username: string;
  password: string;
  publicKey: string;
}

export interface UpdatePublicKeyInput {
  publicKey: string;
}

export interface CreateGroupInput {
  name: string;
}

export interface AddMemberInput {
  groupId: string;
  username: string;
}

export interface RemoveMemberInput {
  groupId: string;
  username: string;
}

export interface SaveGroupKeyInput {
  groupId: string;
  userId?: string | null;
  keyVersion: number;
  encryptedGroupKey: string;
  iv: string;
  senderPublicKey: string;
}

export interface SendMessageInput {
  groupId: string;
  encryptedContent: string;
  iv: string;
  keyVersion: number;
}