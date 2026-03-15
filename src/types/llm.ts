export type GenreRegister =
  | 'academic'
  | 'narrative'
  | 'analytical'
  | 'field-journal'
  | 'freewrite';

export type Scale = 'word' | 'phrase' | 'clause' | 'sentence' | 'paragraph';

export interface RefinementSettings {
  genre: GenreRegister;
  scale: Scale;
  temperature: number;
}

export interface Variant {
  label: 'cool' | 'warm' | 'hot';
  temperature: number;
  text: string;
}
