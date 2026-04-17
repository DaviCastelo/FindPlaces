export type ContactSource =
  | "osm"
  | "website_tel_link"
  | "website_whatsapp_link"
  | "website_regex"
  | "derived_from_phone"
  | "unknown";

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
  phoneSource?: ContactSource;
  whatsappSource?: ContactSource;
  contactConfidence?: "high" | "medium" | "low";
  enrichmentJobId?: string;
  enrichmentStatus?: "queued" | "processing" | "completed" | "failed";
  email?: string;
  website?: string;
  mapsUrl?: string;
  dataSource?: string;
  legalBasis?: string;
  contactPurpose?: string;
};

export type SearchResponse = {
  results: BusinessResult[];
  nextPageToken?: string;
};

export type CategoryOption = {
  id: string;
  label: string;
  enabled: boolean;
};

export type CategoryConfigResponse = {
  categories: CategoryOption[];
  updatedAt: string;
};
