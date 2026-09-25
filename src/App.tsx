import React, { useEffect, useRef, useState } from "react";
import { chatService } from "./chatService";
import { cryptoService } from "./cryptoService";
import { cryptoHandler } from "./cryptoHandler";
import { User, ChatGroup, Message, GroupMember } from "./types";

const parseGroupId = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const parseKeyVersion = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
};

export default function App() {
  const [token, setToken] = useState<string | null>(sessionStorage.getItem("sca_token"));
  const [currentUsername, setCurrentUsername] = useState(sessionStorage.getItem("sca_username") || "");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<User[]>([]);
  const [myMembership, setMyMembership] = useState<GroupMember | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");

  const [activeGroupKey, setActiveGroupKey] = useState<CryptoKey | null>(null);
  const [currentKeyVersion, setCurrentKeyVersion] = useState(1);

  const [newGroupName, setNewGroupName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const groupKeysRef = useRef<Record<string, Record<number, CryptoKey>>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const clearKeys = () => {
    groupKeysRef.current = {};
  };

  const clearGroupState = () => {
    setActiveGroupKey(null);
    setMessages([]);
    setGroupMembers([]);
    setMyMembership(null);
    setCurrentKeyVersion(1);
  };

  const addMessage = (message: Message) => {
    setMessages(prev =>
      prev.some(m => String(m.id) === String(message.id))
        ? prev
        : [...prev, message]
    );
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (token) loadGroups();
  }, [token]);

  const initGroupKey = async (
    rawGroupId: string | number,
    targetVersion?: string | number,
    updateActive = true
  ): Promise<CryptoKey | null> => {
    const id = parseGroupId(rawGroupId);
    if (!id) {
      if (updateActive) {
        setActiveGroupKey(null);
        setError("Invalid group ID.");
      }
      return null;
    }

    try {
      let version = parseKeyVersion(targetVersion);

      if (!version) {
        const serverVersion = await chatService.getGroupKeyVersion(String(id));
        version =
          parseKeyVersion(serverVersion) ||
          parseKeyVersion(selectedGroup?.keyVersion) ||
          1;
      }

      const cache = groupKeysRef.current[String(id)] || {};
      if (cache[version]) {
        if (updateActive) {
          setActiveGroupKey(cache[version]);
          setCurrentKeyVersion(version);
        }
        return cache[version];
      }

      const key = await cryptoHandler.loadGroupKey(
        id,
        version,
        async (requestedId, requestedVersion) => {
          const safeId = parseGroupId(requestedId);
          const safeVersion = parseKeyVersion(requestedVersion);
          if (!safeId || !safeVersion) return null;

          const data = await chatService.getGroupKeyForUser(String(safeId), safeVersion);
          if (!data) return null;

          return {
            groupId: safeId,
            keyVersion: safeVersion,
            encryptedGroupKey: data.encryptedGroupKey,
            iv: data.iv,
            senderPublicKey: data.senderPublicKey
          };
        }
      );

      if (!groupKeysRef.current[String(id)]) {
        groupKeysRef.current[String(id)] = {};
      }

      groupKeysRef.current[String(id)][version] = key;

      if (updateActive) {
        setActiveGroupKey(key);
        setCurrentKeyVersion(version);
      }

      return key;
    } catch (err) {
      if (updateActive) {
        setActiveGroupKey(null);
        setError("Could not access room encryption key.");
      }
      return null;
    }
  };

  const getOrLoadKey = async (id: number, version: number): Promise<CryptoKey | null> => {
    const cached = groupKeysRef.current[String(id)]?.[version];
    if (cached) return cached;
    return initGroupKey(id, version, false);
  };

  const decryptMessages = async (
    id: number,
    source: Message[]
  ): Promise<Message[]> => {
    const safeId = parseGroupId(id);
    if (!safeId || !Array.isArray(source)) return [];

    const versions = [...new Set(source.map(m => parseKeyVersion(m.keyVersion) || 1))];
    await Promise.all(versions.map(v => getOrLoadKey(safeId, v)));

    return Promise.all(
      source.map(async message => {
        const version = parseKeyVersion(message.keyVersion) || 1;

        try {
          const key = groupKeysRef.current[String(safeId)]?.[version];
          if (!key) throw new Error(`Missing key v${version}`);

          const content = await cryptoHandler.decryptMessage(
            key,
            message.encryptedContent,
            message.iv
          );

          return { ...message, content };
        } catch (err) {
          return { ...message, content: "[Decryption failed]" };
        }
      })
    );
  };

  const loadGroups = async () => {
    try {
      const data = await chatService.getAllGroups();
      const loaded = Array.isArray(data) ? data : [];

      setGroups(loaded);

      setSelectedGroup(current => {
        if (current && loaded.some(g => String(g.id) === String(current.id))) {
          return current;
        }
        return loaded[0] || null;
      });

      if (!loaded.length) clearGroupState();
    } catch (err: any) {
      setError("Failed to load groups: " + (err?.message || "Error"));
    }
  };

  const loadGroupDetails = async (rawId: string | number) => {
    const id = parseGroupId(rawId);
    if (!id) {
      setError("Invalid group ID.");
      return;
    }

    try {
      const members = await chatService.getGroupMembers(String(id));
      if (!Array.isArray(members)) throw new Error("Invalid members response.");

      let membership: GroupMember | null = null;
      let version: number | null = null;

      try {
        membership = await chatService.getMyGroupMembership(String(id));
      } catch (err) {}

      try {
        version = parseKeyVersion(await chatService.getGroupKeyVersion(String(id)));
      } catch (err) {}

      setGroupMembers(members);
      setMyMembership(membership);
      setCurrentKeyVersion(
        version || parseKeyVersion(selectedGroup?.keyVersion) || 1
      );
    } catch (err: any) {
      const msg = err?.message || "";

      if (msg.includes("NOT_GROUP_MEMBER") || msg.includes("NotGroupMember")) {
        setSelectedGroup(null);
        clearGroupState();
        await loadGroups();
        return;
      }

      setGroupMembers([]);
      setMyMembership(null);
      setError("Failed to load group details: " + (msg || "Error"));
    }
  };

  useEffect(() => {
    const id = parseGroupId(selectedGroup?.id);

    if (!id) {
      clearGroupState();
      return;
    }

    let cancelled = false;

    const prepare = async () => {
      try {
        setError("");
        setSuccessMessage("");
        setMessages([]);
        setActiveGroupKey(null);

        await loadGroupDetails(id);
        if (cancelled) return;

        const key = await initGroupKey(id, undefined, true);
        if (cancelled) return;

        if (!key) {
          setMessages([]);
          return;
        }

        const history = await chatService.getGroupChatHistory(String(id));
        if (cancelled) return;

        const decrypted = await decryptMessages(id, history || []);
        if (!cancelled) setMessages(decrypted);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load group.");
        }
      }
    };

    prepare();

    return () => {
      cancelled = true;
    };
  }, [selectedGroup?.id]);

  useEffect(() => {
    const id = parseGroupId(selectedGroup?.id);
    if (!id || !token || !activeGroupKey) return;

    let disposed = false;

    const subscription = chatService.subscribeToMessageAdded(
      String(id),
      async incoming => {
        if (disposed) return;

        const incomingId = parseGroupId(incoming.groupId);
        if (!incomingId || incomingId !== id) return;

        const version = parseKeyVersion(incoming.keyVersion) || 1;

        try {
          const key = await getOrLoadKey(id, version);
          if (!key) throw new Error(`Missing key v${version}`);

          const content = await cryptoHandler.decryptMessage(
            key,
            incoming.encryptedContent,
            incoming.iv
          );

          if (!disposed) addMessage({ ...incoming, content });
        } catch (err) {
          if (!disposed) {
            addMessage({
              ...incoming,
              content: "[Decryption failed]"
            });
          }
        }
      },
      err => {}
    );

    return () => {
      disposed = true;
      try {
        subscription?.unsubscribe();
      } catch (err) {}
    };
  }, [selectedGroup?.id, token, activeGroupKey]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);

    try {
      setError("");
      setSuccessMessage("");

      const cleanUsername = username.trim();
      if (!cleanUsername) throw new Error("Username is required.");

      const result = await chatService.login({
        username: cleanUsername,
        password
      });

      if (!result?.accessToken) {
        throw new Error("Access token was not returned.");
      }

      sessionStorage.setItem("sca_token", result.accessToken);
      sessionStorage.setItem("sca_username", cleanUsername);

      setToken(result.accessToken);
      setCurrentUsername(cleanUsername);
      setPassword("");
      clearKeys();
    } catch (err: any) {
      setError("Login failed: " + (err?.message || "Check your credentials"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);

    try {
      setError("");
      setSuccessMessage("");

      const cleanUsername = username.trim();
      if (!cleanUsername) throw new Error("Username is required.");
      if (!password) throw new Error("Password is required.");

      const keyPair = await cryptoService.generateKeyPair();
      const publicKey = await cryptoService.exportPublicKey(keyPair.publicKey);

      await chatService.registerUser({
        username: cleanUsername,
        password,
        publicKey
      });

      await cryptoService.savePrivateKey(keyPair.privateKey);

      const result = await chatService.login({
        username: cleanUsername,
        password
      });

      if (!result?.accessToken) {
        throw new Error("Access token was not returned.");
      }

      sessionStorage.setItem("sca_token", result.accessToken);
      sessionStorage.setItem("sca_username", cleanUsername);

      setToken(result.accessToken);
      setCurrentUsername(cleanUsername);
      setPassword("");
      clearKeys();
      setSuccessMessage("Registration and login successful!");
    } catch (err: any) {
      setError("Registration error: " + (err?.message || "Username might be taken"));
    } finally {
      setIsLoading(false);
    }
  };

  const saveKeyPacket = async (packet: {
    groupId: number;
    userId: number;
    keyVersion: number;
    encryptedGroupKey: string;
    iv: string;
    senderPublicKey: string;
  }) => {
    await chatService.saveGroupKey({
      ...packet,
      groupId: String(packet.groupId),
      userId: String(packet.userId),
      keyVersion: packet.keyVersion
    });
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !newGroupName.trim()) return;

    setIsLoading(true);

    try {
      setError("");
      setSuccessMessage("");

      const created = await chatService.createGroup({
        name: newGroupName.trim()
      });

      const id = parseGroupId(created?.id);
      if (!id) throw new Error("Created group has an invalid ID.");

      const members = await chatService.getGroupMembers(String(id));
      if (!members?.length) throw new Error("Group has no members.");

      const missing = members.find(member => !member.publicKey);
      if (missing) throw new Error(`Public key not found for @${missing.username}.`);

      await cryptoHandler.createAndDistributeKeys(
        id,
        1,
        members.map(member => ({
          id: Number(member.id),
          publicKey: member.publicKey!
        })),
        saveKeyPacket
      );

      await initGroupKey(id, 1, false);

      setNewGroupName("");
      setSuccessMessage(`Room "${created.name}" created.`);
      await loadGroups();

      setSelectedGroup({
        ...created,
        id: String(id),
        keyVersion: 1
      });
    } catch (err: any) {
      setError("Failed to create group: " + (err?.message || "Error"));
    } finally {
      setIsLoading(false);
    }
  };

  const executeKeyRotation = async (
    rawId: string | number,
    membersOverride?: { id: string | number; publicKey?: string | null }[],
    alreadyRotatedOnServer = false
  ) => {
    const id = parseGroupId(rawId);
    if (!id) throw new Error("Invalid group ID for key rotation.");

    const stringId = String(id);
    const next = alreadyRotatedOnServer
      ? parseKeyVersion(await chatService.getGroupKeyVersion(stringId))
      : parseKeyVersion(await chatService.rotateGroupKey(stringId));

    if (!next) throw new Error("Could not determine the new group key version.");

    const members = membersOverride ?? (await chatService.getGroupMembers(stringId));
    if (!members?.length) throw new Error("Group has no members.");

    const missing = members.find(member => !member.publicKey);
    if (missing) {
      throw new Error(`Public key not found for @${(missing as any).username ?? missing.id}.`);
    }

    await cryptoHandler.createAndDistributeKeys(
      id,
      next,
      members.map(member => ({
        id: Number(member.id),
        publicKey: member.publicKey!
      })),
      saveKeyPacket
    );

    clearKeys();

    const newKey = await initGroupKey(id, next, true);
    if (!newKey) throw new Error(`Group key v${next} could not be loaded.`);

    setCurrentKeyVersion(next);

    setGroups(prev =>
      prev.map(group =>
        String(group.id) === stringId ? { ...group, keyVersion: next } : group
      )
    );

    setSelectedGroup(current =>
      current && String(current.id) === stringId ? { ...current, keyVersion: next } : current
    );

    return newKey;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !newMessage.trim() || !selectedGroup) return;

    const id = parseGroupId(selectedGroup.id);
    if (!id) {
      setError("Cannot send message: invalid group ID.");
      return;
    }

    setIsLoading(true);

    try {
      setError("");
      const version = currentKeyVersion || 1;
      const key = await getOrLoadKey(id, version);

      if (!key) throw new Error(`Group encryption key v${version} could not be loaded.`);

      await cryptoHandler.encryptAndSend(
        key,
        newMessage.trim(),
        version,
        async payload => {
          await chatService.sendMessage({
            groupId: String(id),
            encryptedContent: payload.encryptedContent,
            iv: payload.iv,
            keyVersion: payload.keyVersion
          });
        }
      );

      setNewMessage("");
    } catch (err: any) {
      setError("Failed to send message: " + (err?.message || "Error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !selectedGroup || !newMemberName.trim()) return;

    const id = parseGroupId(selectedGroup.id);
    if (!id) {
      setError("Invalid group ID.");
      return;
    }

    setIsLoading(true);

    try {
      setError("");
      const cleanName = newMemberName.trim();

      await chatService.addGroupMember({
        groupId: String(id),
        username: cleanName
      });

      const members = await chatService.getGroupMembers(String(id));
      await executeKeyRotation(id, members, true);

      setNewMemberName("");
      setSuccessMessage(`@${cleanName} added and encryption key rotated.`);
      setGroupMembers(members);
    } catch (err: any) {
      setError("Failed to add member: " + (err?.message || "Error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMember = async (usernameToRemove: string) => {
    if (isLoading || !selectedGroup) return;

    const id = parseGroupId(selectedGroup.id);
    if (!id) {
      setError("Invalid group ID.");
      return;
    }

    setIsLoading(true);

    try {
      setError("");

      await chatService.removeGroupMember({
        groupId: String(id),
        username: usernameToRemove
      });

      const members = await chatService.getGroupMembers(String(id));
      await executeKeyRotation(id, members, true);

      setSuccessMessage(`@${usernameToRemove} removed and encryption key rotated.`);
      setGroupMembers(members);
    } catch (err: any) {
      setError("Failed to remove member: " + (err?.message || "Error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (isLoading || !selectedGroup) return;

    const id = parseGroupId(selectedGroup.id);
    if (!id) {
      setError("Invalid group ID.");
      return;
    }

    setIsLoading(true);

    try {
      setError("");

      await chatService.removeGroupMember({
        groupId: String(id),
        username: currentUsername
      });

      clearGroupState();
      setGroups(prev => prev.filter(group => String(group.id) !== String(id)));
      setSelectedGroup(null);
      await loadGroups();
    } catch (err: any) {
      setError("Failed to leave group: " + (err?.message || "Error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRotateKey = async () => {
    if (isLoading || !selectedGroup) return;

    const id = parseGroupId(selectedGroup.id);
    if (!id) {
      setError("Invalid group ID.");
      return;
    }

    setIsLoading(true);

    try {
      setError("");
      await executeKeyRotation(id);
      setSuccessMessage("Group encryption key rotated successfully.");
    } catch (err: any) {
      setError("Failed to rotate key: " + (err?.message || "Error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("sca_token");
    sessionStorage.removeItem("sca_username");
    sessionStorage.removeItem("sca_userid");

    clearKeys();
    clearGroupState();

    setToken(null);
    setCurrentUsername("");
    setSelectedGroup(null);
    setGroups([]);
  };

  const memberRole = String(myMembership?.role || "").toUpperCase();
  const isOwner = memberRole === "OWNER" || memberRole === "ADMIN";

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#090d16] text-gray-100">
        <div className="w-full max-w-md p-8 bg-gray-900/90 rounded-3xl border border-white/10 shadow-2xl">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-white">Secure Chat</h1>
            <p className="text-xs text-gray-400">End-to-End Encrypted Messaging</p>
          </div>

          {error && <div className="p-3 mb-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-xs">{error}</div>}
          {successMessage && <div className="p-3 mb-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs">{successMessage}</div>}

          <form onSubmit={authMode === "login" ? handleLogin : handleRegister} className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none"
              required
            />

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none pr-14"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-3 text-gray-400 text-xs"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-indigo-600 disabled:opacity-50 text-white rounded-xl font-semibold text-sm"
            >
              {isLoading ? "Please wait..." : authMode === "login" ? "Sign In" : "Sign Up"}
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode(mode => mode === "login" ? "register" : "login");
                setError("");
                setSuccessMessage("");
              }}
              className="w-full py-2.5 bg-white/5 text-gray-300 rounded-xl text-xs"
            >
              {authMode === "login"
                ? "Don't have an account? Sign Up"
                : "Already have an account? Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#090d16] text-gray-100 overflow-hidden">
      <aside className="w-72 shrink-0 bg-[#0b0f19] border-r border-white/6 flex flex-col">
        <div className="p-4 border-b border-white/6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center font-bold">
              {currentUsername.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold">@{currentUsername}</div>
              <div className="text-[10px] text-emerald-400">● Active</div>
            </div>
          </div>
          <button onClick={handleLogout} className="text-red-400 text-xs">Logout</button>
        </div>

        <form onSubmit={handleCreateGroup} className="p-3 flex gap-2 border-b border-white/6">
          <input
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            placeholder="Create room..."
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs"
          />
          <button
            type="submit"
            disabled={isLoading || !newGroupName.trim()}
            className="px-3 bg-indigo-600 disabled:opacity-50 rounded-xl"
          >
            +
          </button>
        </form>

        <div className="p-2.5">
          <input
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            placeholder="Search rooms..."
            className="w-full px-3 py-1.5 bg-white/3 border border-white/5 rounded-lg text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {!filteredGroups.length ? (
            <div className="text-center text-gray-500 text-xs py-8">No rooms found.</div>
          ) : (
            filteredGroups.map(group => {
              const selected = String(selectedGroup?.id) === String(group.id);
              const version = parseKeyVersion(group.keyVersion) || 1;

              return (
                <button
                  key={String(group.id)}
                  onClick={() => setSelectedGroup(group)}
                  className={`w-full px-3 py-2.5 rounded-xl flex justify-between text-left ${
                    selected ? "bg-indigo-600/20 text-white border border-indigo-500/30" : "text-gray-400 hover:bg-white/3"
                  }`}
                >
                  <span className="text-sm truncate">{group.name}</span>
                  <span className="text-[10px] font-mono">v{version}</span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-[#090d16]/50 min-w-0">
        {selectedGroup ? (
          <>
            <header className="h-16 px-6 border-b border-white/6 flex items-center justify-between bg-[#0b0f19]/50">
              <div>
                <h2 className="font-semibold">{selectedGroup.name}</h2>
                <span className="text-xs text-gray-400">
                  {groupMembers.length} Members · Key v{currentKeyVersion}
                </span>
              </div>

              {isOwner && (
                <form onSubmit={handleAddMember} className="flex gap-2">
                  <input
                    value={newMemberName}
                    onChange={e => setNewMemberName(e.target.value)}
                    placeholder="Username..."
                    className="w-36 px-3 py-1.5 bg-black/40 border border-white/10 rounded-xl text-xs"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !newMemberName.trim()}
                    className="px-3 py-1.5 bg-white/10 disabled:opacity-50 rounded-xl text-xs"
                  >
                    Add
                  </button>
                </form>
              )}
            </header>

            {(error || successMessage) && (
              <div className={`px-6 py-2 text-xs flex justify-between ${
                error ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"
              }`}>
                <span>{error || successMessage}</span>
                <button onClick={() => { setError(""); setSuccessMessage(""); }}>✕</button>
              </div>
            )}

            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {!messages.length ? (
                <div className="h-full flex items-center justify-center text-gray-500 text-center">
                  <div>
                    <div className="text-sm">No messages yet.</div>
                    <div className="text-xs mt-1">Messages are end-to-end encrypted.</div>
                  </div>
                </div>
              ) : (
                messages.map((message, index) => {
                  const isMe = message.senderName === currentUsername;

                  return (
                    <div
                      key={message.id ? String(message.id) : index}
                      className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                    >
                      <span className="text-[11px] text-gray-400 mb-1">
                        @{message.senderName}
                      </span>

                      <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm break-words ${
                        isMe
                          ? "bg-indigo-600 text-white"
                          : "bg-white/6 text-gray-100 border border-white/5"
                      }`}>
                        {message.content || "[Encrypted content]"}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-4 px-6 border-t border-white/6 flex gap-3">
              <input
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                disabled={!activeGroupKey || isLoading}
                placeholder={activeGroupKey ? "Type an encrypted message..." : "Loading encryption key..."}
                className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!newMessage.trim() || !activeGroupKey || isLoading}
                className="px-5 py-3 bg-indigo-600 disabled:opacity-50 rounded-xl text-sm"
              >
                {isLoading ? "..." : "Send"}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <h3 className="text-base font-semibold text-gray-300">No Room Selected</h3>
              <p className="text-xs mt-1">Select a room from the sidebar.</p>
            </div>
          </div>
        )}
      </main>

      {selectedGroup && (
        <aside className="w-64 shrink-0 bg-[#0b0f19] border-l border-white/6 flex flex-col p-4">
          <h3 className="text-sm font-semibold pb-3 border-b border-white/6">
            Members ({groupMembers.length})
          </h3>

          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {!groupMembers.length ? (
              <div className="text-xs text-gray-500 text-center py-4">
                No members found.
              </div>
            ) : (
              groupMembers.map(member => (
                <div
                  key={String(member.id)}
                  className="p-2.5 rounded-xl bg-white/2 border border-white/5 flex items-center justify-between"
                >
                  <span className="text-xs truncate">
                    @{member.username}
                    {member.username === currentUsername && " (you)"}
                  </span>

                  {isOwner && member.username !== currentUsername && (
                    <button
                      onClick={() => handleRemoveMember(member.username)}
                      disabled={isLoading}
                      className="text-red-400 text-xs disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {isOwner && (
            <button
              onClick={handleRotateKey}
              disabled={isLoading}
              className="w-full py-2 mb-2 bg-white/5 disabled:opacity-50 text-indigo-300 rounded-xl text-xs"
            >
              {isLoading ? "Rotating..." : "Rotate Key"}
            </button>
          )}

          <button
            onClick={handleLeaveGroup}
            disabled={isLoading}
            className="w-full py-2 bg-red-500/10 text-red-300 disabled:opacity-50 rounded-xl text-xs"
          >
            Leave Group
          </button>
        </aside>
      )}
    </div>
  );
}