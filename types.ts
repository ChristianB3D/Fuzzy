
export interface CabinDetails {
  wifiName: string;
  wifiPass: string;
  checkIn: string;
  checkOut: string;
  hostPhone: string;
  address: string;
  rules: string[];
}

export interface Message {
  role: 'user' | 'fuzzy';
  text: string;
  timestamp: Date;
  sources?: { uri: string; title: string }[];
}

export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}
