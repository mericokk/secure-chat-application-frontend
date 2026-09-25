import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  gql,
} from '@apollo/client';
import { createClient, Client } from 'graphql-ws';
import { setContext } from '@apollo/client/link/context';

import {
  User,
  ChatGroup,
  GroupMember,
  GroupKey,
  Message,
  LoginInput,
  LoginResponse,
  RegisterUserInput,
  UpdatePublicKeyInput,
  CreateGroupInput,
  AddMemberInput,
  RemoveMemberInput,
  SaveGroupKeyInput,
  SendMessageInput,
} from './types';

export const GRAPHQL_HTTP_URI =
  (import.meta as any).env?.VITE_GRAPHQL_HTTP_URL ||
  'http://localhost:8080/graphql';

export const GRAPHQL_WS_URI =
  (import.meta as any).env?.VITE_GRAPHQL_WS_URL ||
  'ws://localhost:8080/graphql';

const httpLink = new HttpLink({
  uri: GRAPHQL_HTTP_URI,
});

const authLink = setContext((_, { headers }) => {
  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('sca_token')
      : null;

  return {
    headers: {
      ...headers,
      Authorization: token ? `Bearer ${token}` : '',
    },
  };
});

export const client = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
  defaultOptions: {
    query: {
      fetchPolicy: 'network-only',
    },
    watchQuery: {
      fetchPolicy: 'network-only',
    },
  },
});

type LoginData = {
  login: LoginResponse;
};

type RegisterData = {
  registerUser: User;
};

type UpdatePublicKeyData = {
  updatePublicKey: User;
};

type CreateGroupData = {
  createGroup: ChatGroup;
};

type AddMemberData = {
  addGroupMember: GroupMember;
};

type RemoveMemberData = {
  removeGroupMember: boolean;
};

type SaveGroupKeyData = {
  saveGroupKey: GroupKey;
};

type RotateGroupKeyData = {
  rotateGroupKey: number;
};

type SendMessageData = {
  sendMessage: Message;
};

type GetUserData = {
  getUser: User | null;
};

type GetGroupsData = {
  getAllGroups: ChatGroup[];
};

type GetMembersData = {
  getGroupMembers: User[];
};

type GetGroupKeyData = {
  getGroupKeyForUser: GroupKey | null;
};

type GetKeyVersionData = {
  getGroupKeyVersion: number;
};

type GetHistoryData = {
  getGroupChatHistory: Message[];
};

type GetMembershipData = {
  getMyGroupMembership: GroupMember | null;
};

type MessageSubscriptionData = {
  messageAdded?: Message;
};

type MemberSubscriptionData = {
  groupMemberAdded?: GroupMember;
};

const createWsClient = (): Client => {
  return createClient({
    url: GRAPHQL_WS_URI,
    connectionParams: () => {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('sca_token')
          : null;

      return {
        Authorization: token ? `Bearer ${token}` : '',
      };
    },
    retryAttempts: 5,
  });
};

export const login = async (
  input: LoginInput
): Promise<LoginResponse> => {
  const res = await client.mutate<LoginData>({
    mutation: gql`
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          accessToken
          refreshToken
        }
      }
    `,
    variables: { input },
  });

  const loginData = res.data?.login;

  if (!loginData?.accessToken) {
    throw new Error('ACCESS_TOKEN_MISSING');
  }

  sessionStorage.setItem('sca_token', loginData.accessToken);

  return loginData;
};

export const registerUser = async (
  input: RegisterUserInput
): Promise<User> => {
  const res = await client.mutate<RegisterData>({
    mutation: gql`
      mutation RegisterUser($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
          username
          publicKey
        }
      }
    `,
    variables: { input },
  });

  if (!res.data?.registerUser) {
    throw new Error('REGISTER_RESPONSE_EMPTY');
  }

  return res.data.registerUser;
};

export const updatePublicKey = async (
  input: UpdatePublicKeyInput
): Promise<User> => {
  const res = await client.mutate<UpdatePublicKeyData>({
    mutation: gql`
      mutation UpdatePublicKey($input: UpdatePublicKeyInput!) {
        updatePublicKey(input: $input) {
          id
          username
          publicKey
        }
      }
    `,
    variables: { input },
  });

  if (!res.data?.updatePublicKey) {
    throw new Error('UPDATE_PUBLIC_KEY_RESPONSE_EMPTY');
  }

  return res.data.updatePublicKey;
};

export const createGroup = async (
  input: CreateGroupInput
): Promise<ChatGroup> => {
  const res = await client.mutate<CreateGroupData>({
    mutation: gql`
      mutation CreateGroup($input: CreateGroupInput!) {
        createGroup(input: $input) {
          id
          name
          keyVersion
          createdAt
        }
      }
    `,
    variables: { input },
  });

  if (!res.data?.createGroup) {
    throw new Error('CREATE_GROUP_RESPONSE_EMPTY');
  }

  return res.data.createGroup;
};

export const addGroupMember = async (
  input: AddMemberInput
): Promise<GroupMember> => {
  const res = await client.mutate<AddMemberData>({
    mutation: gql`
      mutation AddGroupMember($input: AddMemberInput!) {
        addGroupMember(input: $input) {
          id
          groupId
          userId
          role
          joinedAt
        }
      }
    `,
    variables: { input },
  });

  if (!res.data?.addGroupMember) {
    throw new Error('ADD_MEMBER_RESPONSE_EMPTY');
  }

  return res.data.addGroupMember;
};

export const removeGroupMember = async (
  input: RemoveMemberInput
): Promise<boolean> => {
  const res = await client.mutate<RemoveMemberData>({
    mutation: gql`
      mutation RemoveGroupMember($input: RemoveMemberInput!) {
        removeGroupMember(input: $input)
      }
    `,
    variables: { input },
  });

  if (res.data?.removeGroupMember === undefined) {
    throw new Error('REMOVE_MEMBER_RESPONSE_EMPTY');
  }

  return res.data.removeGroupMember;
};

export const saveGroupKey = async (
  input: SaveGroupKeyInput
): Promise<GroupKey> => {
  const res = await client.mutate<SaveGroupKeyData>({
    mutation: gql`
      mutation SaveGroupKey($input: SaveGroupKeyInput!) {
        saveGroupKey(input: $input) {
          id
          groupId
          userId
          keyVersion
          encryptedGroupKey
          iv
          senderPublicKey
        }
      }
    `,
    variables: { input },
  });

  if (!res.data?.saveGroupKey) {
    throw new Error('SAVE_GROUP_KEY_RESPONSE_EMPTY');
  }

  return res.data.saveGroupKey;
};

export const rotateGroupKey = async (
  groupId: string
): Promise<number> => {
  const res = await client.mutate<RotateGroupKeyData>({
    mutation: gql`
      mutation RotateGroupKey($groupId: ID!) {
        rotateGroupKey(groupId: $groupId)
      }
    `,
    variables: { groupId },
  });

  if (res.data?.rotateGroupKey === undefined) {
    throw new Error('ROTATE_GROUP_KEY_RESPONSE_EMPTY');
  }

  return res.data.rotateGroupKey;
};

export const sendMessage = async (
  input: SendMessageInput
): Promise<Message> => {
  const res = await client.mutate<SendMessageData>({
    mutation: gql`
      mutation SendMessage($input: SendMessageInput!) {
        sendMessage(input: $input) {
          id
          senderId
          senderName
          groupId
          encryptedContent
          iv
          keyVersion
          createdAt
        }
      }
    `,
    variables: { input },
  });

  if (!res.data?.sendMessage) {
    throw new Error('SEND_MESSAGE_RESPONSE_EMPTY');
  }

  return res.data.sendMessage;
};

export const getUser = async (
  username: string
): Promise<User | null> => {
  const res = await client.query<GetUserData>({
    query: gql`
      query GetUser($username: String!) {
        getUser(username: $username) {
          id
          username
          publicKey
        }
      }
    `,
    variables: { username },
    fetchPolicy: 'network-only',
  });

  return res.data?.getUser ?? null;
};

export const getAllGroups = async (): Promise<ChatGroup[]> => {
  const res = await client.query<GetGroupsData>({
    query: gql`
      query GetAllGroups {
        getAllGroups {
          id
          name
          keyVersion
          createdAt
        }
      }
    `,
    fetchPolicy: 'network-only',
  });

  return res.data?.getAllGroups ?? [];
};

export const getGroupMembers = async (
  groupId: string
): Promise<User[]> => {
  const res = await client.query<GetMembersData>({
    query: gql`
      query GetGroupMembers($groupId: ID!) {
        getGroupMembers(groupId: $groupId) {
          id
          username
          publicKey
        }
      }
    `,
    variables: { groupId },
    fetchPolicy: 'network-only',
  });

  return res.data?.getGroupMembers ?? [];
};

export const getGroupKeyForUser = async (
  groupId: string,
  keyVersion?: number
): Promise<GroupKey | null> => {
  const res = await client.query<GetGroupKeyData>({
    query: gql`
      query GetGroupKeyForUser($groupId: ID!, $keyVersion: Int) {
        getGroupKeyForUser(groupId: $groupId, keyVersion: $keyVersion) {
          id
          groupId
          userId
          keyVersion
          encryptedGroupKey
          iv
          senderPublicKey
        }
      }
    `,
    variables: {
      groupId,
      keyVersion,
    },
    fetchPolicy: 'network-only',
  });

  return res.data?.getGroupKeyForUser ?? null;
};

export const getGroupKeyVersion = async (
  groupId: string
): Promise<number> => {
  const res = await client.query<GetKeyVersionData>({
    query: gql`
      query GetGroupKeyVersion($groupId: ID!) {
        getGroupKeyVersion(groupId: $groupId)
      }
    `,
    variables: { groupId },
    fetchPolicy: 'network-only',
  });

  if (res.data?.getGroupKeyVersion === undefined) {
    throw new Error('GROUP_KEY_VERSION_RESPONSE_EMPTY');
  }

  return res.data.getGroupKeyVersion;
};

export const getGroupChatHistory = async (
  groupId: string
): Promise<Message[]> => {
  const res = await client.query<GetHistoryData>({
    query: gql`
      query GetGroupChatHistory($groupId: ID!) {
        getGroupChatHistory(groupId: $groupId) {
          id
          senderId
          senderName
          groupId
          encryptedContent
          iv
          keyVersion
          createdAt
        }
      }
    `,
    variables: { groupId },
    fetchPolicy: 'network-only',
  });

  return res.data?.getGroupChatHistory ?? [];
};

export const getMyGroupMembership = async (
  groupId: string
): Promise<GroupMember | null> => {
  const res = await client.query<GetMembershipData>({
    query: gql`
      query GetMyGroupMembership($groupId: ID!) {
        getMyGroupMembership(groupId: $groupId) {
          id
          groupId
          userId
          role
          joinedAt
        }
      }
    `,
    variables: { groupId },
    fetchPolicy: 'network-only',
  });

  return res.data?.getMyGroupMembership ?? null;
};

export const subscribeToMessageAdded = (
  groupId: string,
  onMessage: (message: Message) => void,
  onError?: (error: unknown) => void
) => {
  const wsClient = createWsClient();
  let disposed = false;

  const dispose = wsClient.subscribe(
    {
      query: `
        subscription OnMessageAdded($groupId: ID!) {
          messageAdded(groupId: $groupId) {
            id
            senderId
            senderName
            groupId
            encryptedContent
            iv
            keyVersion
            createdAt
          }
        }
      `,
      variables: { groupId },
    },
    {
      next: (result) => {
        if (disposed) return;

        const data = result.data as MessageSubscriptionData | undefined;

        if (data?.messageAdded) {
          onMessage(data.messageAdded);
        }
      },
      error: (error) => {
        if (disposed) return;
        onError?.(error);
      },
      complete: () => {
        if (disposed) return;
      },
    }
  );

  return {
    unsubscribe: () => {
      if (disposed) return;
      disposed = true;
      dispose();
      wsClient.dispose();
    },
  };
};

export const subscribeToGroupMemberAdded = (
  onMember: (member: GroupMember) => void,
  onError?: (error: unknown) => void
) => {
  const wsClient = createWsClient();
  let disposed = false;

  const dispose = wsClient.subscribe(
    {
      query: `
        subscription OnGroupMemberAdded {
          groupMemberAdded {
            id
            groupId
            userId
            role
            joinedAt
          }
        }
      `,
    },
    {
      next: (result) => {
        if (disposed) return;

        const data = result.data as MemberSubscriptionData | undefined;

        if (data?.groupMemberAdded) {
          onMember(data.groupMemberAdded);
        }
      },
      error: (error) => {
        if (disposed) return;
        onError?.(error);
      },
      complete: () => {
        if (disposed) return;
      },
    }
  );

  return {
    unsubscribe: () => {
      if (disposed) return;
      disposed = true;
      dispose();
      wsClient.dispose();
    },
  };
};

export const chatService = {
  login,
  registerUser,
  updatePublicKey,
  createGroup,
  addGroupMember,
  removeGroupMember,
  saveGroupKey,
  rotateGroupKey,
  sendMessage,
  getUser,
  getAllGroups,
  getGroupMembers,
  getGroupKeyForUser,
  getGroupKeyVersion,
  getGroupChatHistory,
  getMyGroupMembership,
  subscribeToMessageAdded,
  subscribeToGroupMemberAdded,
};

export default chatService;