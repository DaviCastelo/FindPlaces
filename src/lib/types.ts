export type BusinessResult = {
  placeId: string;
  name: string;
  address: string;
  location?: {
    lat: number;
    lng: number;
  };
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  mapsUrl?: string;
};

export type SearchResponse = {
  results: BusinessResult[];
  nextPageToken?: string;
};
