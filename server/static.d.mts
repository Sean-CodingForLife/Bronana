/* server/static.mjs 的类型声明（TS 侧 import 它时用；实现刻意不写成 TS，
   因为 Electron 自带的 Node 不支持类型擦除，而这一份是 Node 与 Electron 共用的） */

export interface StaticServerOptions {
  root?: string;
  host?: string;
  port?: number;
  log?: ((line: string) => void) | null;
}

export interface StaticServer {
  server: any;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** 把请求路径映射成 root 之内的绝对路径；越界返回 null */
export function resolveInside(root: string, urlPath: string): string | null;

/** 请求处理器（可直接用假的 req/res 单测，不必真的监听端口） */
export function createHandler(opts?: StaticServerOptions): (req: any, res: any) => void;

/** 监听；port 传 0 让系统分配 */
export function listen(opts?: StaticServerOptions): Promise<StaticServer>;
