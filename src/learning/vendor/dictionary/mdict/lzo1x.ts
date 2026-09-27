/**
 * Pure TypeScript LZO1X decompressor.
 * Ported from fengdh/minilzo-decompress.js (based on minilzo.c by Markus Oberhumer).
 *
 * Only decompression is needed for reading MDX dictionary files.
 */

export function lzo1xDecompress(input: Uint8Array | Buffer, outLen: number): Buffer {
    const c_top_loop = 1;
    const c_first_literal_run = 2;
    const c_match = 3;
    const c_copy_match = 4;
    const c_match_done = 5;
    const c_match_next = 6;

    const out = Buffer.alloc(outLen);
    let op = 0;
    let ip = 0;
    let t = input[ip];
    let state = c_top_loop;
    let m_pos = 0;

    if (t > 17) {
        ip++;
        t -= 17;
        if (t < 4) {
            state = c_match_next;
        } else {
            do { out[op++] = input[ip++]; } while (--t > 0);
            state = c_first_literal_run;
        }
    }

    top_loop_ori: do {
        let if_block = false;
        switch (state) {
            case c_top_loop:
                t = input[ip++];
                if (t >= 16) {
                    state = c_match;
                    continue top_loop_ori;
                }
                if (t === 0) {
                    while (input[ip] === 0) { t += 255; ip++; }
                    t += 15 + input[ip++];
                }
                t += 3;
                do { out[op++] = input[ip++]; } while (--t > 0);

            // falls through
            case c_first_literal_run:
                t = input[ip++];
                if (t >= 16) {
                    state = c_match;
                    continue top_loop_ori;
                }
                m_pos = op - 0x801 - (t >> 2) - (input[ip++] << 2);
                out[op++] = out[m_pos++];
                out[op++] = out[m_pos++];
                out[op++] = out[m_pos];
                state = c_match_done;
                continue top_loop_ori;

            case c_match:
                if (t >= 64) {
                    m_pos = op - 1 - ((t >> 2) & 7) - (input[ip++] << 3);
                    t = (t >> 5) - 1;
                    state = c_copy_match;
                    continue top_loop_ori;
                } else if (t >= 32) {
                    t &= 31;
                    if (t === 0) {
                        while (input[ip] === 0) { t += 255; ip++; }
                        t += 31 + input[ip++];
                    }
                    m_pos = op - 1 - ((input[ip] + (input[ip + 1] << 8)) >> 2);
                    ip += 2;
                } else if (t >= 16) {
                    m_pos = op - ((t & 8) << 11);
                    t &= 7;
                    if (t === 0) {
                        while (input[ip] === 0) { t += 255; ip++; }
                        t += 7 + input[ip++];
                    }
                    m_pos -= ((input[ip] + (input[ip + 1] << 8)) >> 2);
                    ip += 2;
                    if (m_pos === op) {
                        break top_loop_ori; // EOF
                    }
                    m_pos -= 0x4000;
                } else {
                    m_pos = op - 1 - (t >> 2) - (input[ip++] << 2);
                    out[op++] = out[m_pos++];
                    out[op++] = out[m_pos];
                    state = c_match_done;
                    continue top_loop_ori;
                }
                if (t >= 6 && (op - m_pos) >= 4) {
                    if_block = true;
                    t += 2;
                    do { out[op++] = out[m_pos++]; } while (--t > 0);
                }

            // falls through
            case c_copy_match:
                if (!if_block) {
                    t += 2;
                    do { out[op++] = out[m_pos++]; } while (--t > 0);
                }

            // falls through
            case c_match_done:
                t = input[ip - 2] & 3;
                if (t === 0) {
                    state = c_top_loop;
                    continue top_loop_ori;
                }

            // falls through
            case c_match_next:
                out[op++] = input[ip++];
                if (t > 1) {
                    out[op++] = input[ip++];
                    if (t > 2) {
                        out[op++] = input[ip++];
                    }
                }
                t = input[ip++];
                state = c_match;
                continue top_loop_ori;
        }
    } while (true);

    return out.slice(0, op);
}
