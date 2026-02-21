import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { StoreData } from './types';

export class Store {
  private filePath: string;
  private data: StoreData;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'config.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw) as StoreData;
      }
    } catch (error) {
      console.error('Store load error:', error);
    }
    return { providers: [] };
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Store save error:', error);
    }
  }

  get<K extends keyof StoreData>(key: K): StoreData[K] {
    return this.data[key];
  }

  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    this.data[key] = value;
    this.save();
  }

  delete<K extends keyof StoreData>(key: K): void {
    delete this.data[key];
    this.save();
  }
}
