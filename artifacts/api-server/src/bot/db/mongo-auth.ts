/**
 * MongoDB-backed WhatsApp (Baileys) auth state.
 * Replaces useMultiFileAuthState — credentials and signal keys are stored
 * in the `wa_auth` MongoDB collection instead of the filesystem.
 */
import {
  initAuthCreds,
  BufferJSON,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { col } from "./mongo.js";

const COLL = "wa_auth";

async function readData(botId: string, file: string): Promise<any> {
  const doc = await col(COLL).findOne({ _id: `${botId}:${file}` as any });
  if (!doc?.data) return null;
  return JSON.parse(doc.data, BufferJSON.reviver);
}

async function writeData(botId: string, file: string, data: object): Promise<void> {
  await col(COLL).updateOne(
    { _id: `${botId}:${file}` as any },
    { $set: { bot_id: botId, data: JSON.stringify(data, BufferJSON.replacer), updated_at: Math.floor(Date.now() / 1000) } },
    { upsert: true }
  );
}

async function removeData(botId: string, file: string): Promise<void> {
  await col(COLL).deleteOne({ _id: `${botId}:${file}` as any });
}

export async function useMongoAuthState(
  botId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const creds: AuthenticationCreds =
    (await readData(botId, "creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
          const data: Record<string, SignalDataTypeMap[typeof type]> = {};
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(botId, `${type}-${id}`);
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}`;
              tasks.push(
                value
                  ? writeData(botId, file, value)
                  : removeData(botId, file)
              );
            }
          }
          await Promise.all(tasks);
        },
        clear: async () => {
          await col(COLL).deleteMany({ bot_id: botId });
        },
        transaction: async (exec: () => Promise<boolean>) => {
          return exec();
        },
      },
    },
    saveCreds: () => writeData(botId, "creds", creds),
  };
}
