/**
 * Minimal INI reader for C&C map files, modelled on Rampastring's IniFile
 * behavior as used by the World-Altering Editor's MapLoader:
 * `[Section]` headers, `Key=Value` pairs, `;` comment lines (line-start only —
 * inline stripping would corrupt pack data), keys/values trimmed.
 */
export class IniFile {
  private readonly sections = new Map<string, Record<string, string>>();

  private constructor() {}

  static parse(text: string): IniFile {
    const ini = new IniFile();
    let current: Record<string, string> | null = null;

    for (const rawLine of text.split(/\r\n|\n|\r/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith(';')) continue;

      if (line.startsWith('[')) {
        const end = line.indexOf(']');
        if (end < 0) continue; // unterminated header — ignore the line
        const name = line.slice(1, end).trim();
        if (name.length === 0) continue;
        let section = ini.sections.get(name);
        if (!section) {
          section = Object.create(null) as Record<string, string>;
          ini.sections.set(name, section);
        }
        current = section; // duplicate [Section] headers merge
        continue;
      }

      if (!current) continue; // key line before any [Section] — ignore
      const eq = line.indexOf('=');
      if (eq <= 0) continue; // no '=' or empty key — ignore
      const key = line.slice(0, eq).trim();
      if (key.length === 0) continue;
      current[key] = line.slice(eq + 1).trim(); // duplicate keys: last one wins
    }

    return ini;
  }

  sectionNames(): string[] {
    return [...this.sections.keys()];
  }

  section(name: string): Record<string, string> | undefined {
    return this.sections.get(name);
  }

  get(section: string, key: string): string | undefined {
    return this.sections.get(section)?.[key];
  }
}
