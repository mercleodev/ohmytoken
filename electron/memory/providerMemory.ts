import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export type ProviderMemoryFile = {
  fileName: string;
  name: string;
  description: string;
  type: string;
  lineCount: number;
  content: string;
};

export type ProviderMemoryStatus = {
  indexLineCount: number;
  indexMaxLines: number;
  indexContent: string;
  files: ProviderMemoryFile[];
  memoryDir: string;
};

const SUPPORTED_PROVIDERS = ['claude', 'codex'] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const normalizeProvider = (provider: string | undefined): SupportedProvider | null => {
  const p = (provider ?? 'claude').toLowerCase();
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p) ? (p as SupportedProvider) : null;
};

export const resolveMemoryDir = (
  provider: string | undefined,
  projectPath: string | undefined,
): string | null => {
  const normalized = normalizeProvider(provider);
  if (!normalized) return null;

  if (normalized === 'codex') {
    return path.join(homedir(), '.codex', 'memories');
  }

  const targetPath = projectPath || process.cwd();
  const encoded = targetPath.replace(/\//g, '-');
  return path.join(homedir(), '.claude', 'projects', encoded, 'memory');
};

export const memoryLabelForProvider = (provider: string | undefined): string => {
  const normalized = normalizeProvider(provider);
  if (normalized === 'codex') return 'Codex Memory';
  return 'Claude Memory';
};

export const readMemoryDir = (memoryDir: string): ProviderMemoryStatus => {
  const indexPath = path.join(memoryDir, 'MEMORY.md');
  const indexContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '';
  const indexLineCount = indexContent.split('\n').length;

  const files = fs
    .readdirSync(memoryDir)
    .filter((f: string) => f.endsWith('.md') && f !== 'MEMORY.md')
    .map((f: string): ProviderMemoryFile => {
      const filePath = path.join(memoryDir, f);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      let name = f.replace('.md', '');
      let description = '';
      let type = 'unknown';
      if (lines[0] === '---') {
        const endIdx = lines.indexOf('---', 1);
        if (endIdx > 0) {
          const frontmatter = lines.slice(1, endIdx).join('\n');
          const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
          const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
          const typeMatch = frontmatter.match(/^type:\s*(.+)$/m);
          if (nameMatch) name = nameMatch[1].trim();
          if (descMatch) description = descMatch[1].trim();
          if (typeMatch) type = typeMatch[1].trim();
        }
      }

      return { fileName: f, name, description, type, lineCount: lines.length, content };
    });

  return { indexLineCount, indexMaxLines: 200, indexContent, files, memoryDir };
};

export const getMemoryStatusForProvider = (args: {
  provider: string | undefined;
  projectPath: string | undefined;
}): ProviderMemoryStatus | null => {
  const memoryDir = resolveMemoryDir(args.provider, args.projectPath);
  if (!memoryDir) return null;
  if (!fs.existsSync(memoryDir)) return null;
  return readMemoryDir(memoryDir);
};
