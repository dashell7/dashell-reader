/**
 * Language Learner 日志系统
 * 生产环境只输出 error 级别日志，开发环境输出所有级别
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
    level: LogLevel;
    prefix: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

// 默认配置：生产环境只输出 warn 及以上
const config: LoggerConfig = {
    level: 'warn',
    prefix: '[Language Learner]',
};

/**
 * 设置日志级别
 */
export function setLogLevel(level: LogLevel): void {
    config.level = level;
}

/**
 * 启用调试模式（输出所有日志）
 */
export function enableDebugMode(): void {
    config.level = 'debug';
}

/**
 * 检查是否应该输出该级别的日志
 */
function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

/**
 * 格式化日志消息
 */
function formatMessage(level: LogLevel, ...args: any[]): any[] {
    const timestamp = new Date().toISOString().slice(11, 19);
    return [`${config.prefix} [${level.toUpperCase()}] [${timestamp}]`, ...args];
}

/**
 * 日志对象
 */
export const logger = {
    debug: (...args: any[]): void => {
        if (shouldLog('debug')) {
            console.log(...formatMessage('debug', ...args));
        }
    },

    info: (...args: any[]): void => {
        if (shouldLog('info')) {
            console.info(...formatMessage('info', ...args));
        }
    },

    warn: (...args: any[]): void => {
        if (shouldLog('warn')) {
            console.warn(...formatMessage('warn', ...args));
        }
    },

    error: (...args: any[]): void => {
        if (shouldLog('error')) {
            console.error(...formatMessage('error', ...args));
        }
    },

    /**
     * 用于关键操作的追踪日志（始终输出）
     */
    trace: (operation: string, data?: any): void => {
        if (shouldLog('info')) {
            console.log(`${config.prefix} [TRACE] ${operation}`, data ?? '');
        }
    },

    /**
     * 用于性能测量
     */
    time: (label: string): void => {
        if (shouldLog('debug')) {
            console.time(`${config.prefix} ${label}`);
        }
    },

    timeEnd: (label: string): void => {
        if (shouldLog('debug')) {
            console.timeEnd(`${config.prefix} ${label}`);
        }
    },
};

export default logger;
