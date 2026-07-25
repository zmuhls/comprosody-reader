export type GenreRegister =
  | 'academic'
  | 'narrative'
  | 'analytical'
  | 'field-journal'
  | 'freewrite';

export type Scale = 'word' | 'phrase' | 'clause' | 'sentence' | 'paragraph';

export type RefinementMode = 'faithful' | 'overhaul';

export interface RefinementSettings {
  genre: GenreRegister;
  scale: Scale;
  temperature: number;
  /** Faithful is a light oral-to-written edit; overhaul may reorganize ideas. */
  mode?: RefinementMode;
  /** Applies the strictest voice- and claim-preservation rules. */
  highFidelity?: boolean;
  /** Runs the faithful pass after each completed transcription segment. */
  autoRefine?: boolean;
}

export interface Variant {
  label: 'cool' | 'warm' | 'hot';
  temperature: number;
  text: string;
}
