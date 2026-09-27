/**
 * 轻量级 API Key 加密工具
 * 使用 Web Crypto API (AES-GCM) 加密敏感数据
 * 密钥通过 PBKDF2 从插件 ID 派生
 */

import { logger } from './logger';

const ENCRYPTION_PREFIX = 'enc:';
const SALT = new Uint8Array([108, 97, 110, 103, 114, 45, 115, 97, 108, 116]); // 'langr-salt'

export class CryptoUtils {
    static isAvailable(): boolean {
        return typeof crypto !== 'undefined' && !!crypto.subtle;
    }

    static isEncrypted(text: string): boolean {
        return text.startsWith(ENCRYPTION_PREFIX);
    }

    private static async deriveKey(passphrase: string): Promise<CryptoKey> {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(passphrase),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    static async encrypt(text: string, pluginId: string): Promise<string> {
        if (!text || !this.isAvailable()) return text;
        const key = await this.deriveKey(pluginId);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(text)
        );
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return ENCRYPTION_PREFIX + btoa(String.fromCharCode(...combined));
    }

    static async decrypt(encrypted: string, pluginId: string): Promise<string> {
        if (!encrypted || !this.isAvailable() || !this.isEncrypted(encrypted)) return encrypted;
        try {
            const data = encrypted.slice(ENCRYPTION_PREFIX.length);
            const raw = Uint8Array.from(atob(data), c => c.charCodeAt(0));
            const iv = raw.slice(0, 12);
            const ciphertext = raw.slice(12);
            const key = await this.deriveKey(pluginId);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                ciphertext
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            logger.warn('[CryptoUtils] Decryption failed:', e);
            return ''; // 解密失败返回空字符串
        }
    }
}
