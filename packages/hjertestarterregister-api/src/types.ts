export type RegistryBoolean = "Y" | "N";

export type SendVia = "EMAIL" | "SMS";

export type DateInput = string;

export interface ApiSuccessResponse {
  API_MESSAGE: string;
  API_CURRENT_USER_ID?: number;
}

export interface ApiErrorResponse {
  API_ERROR: string;
  API_MESSAGE?: string;
}

export interface OAuthAccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface RegistryAsset {
  ASSET_ID: number;
  ASSET_GUID: string;
  SERIAL_NUMBER?: string;
  ASSET_TYPE_ID?: number;
  ASSET_TYPE_NAME?: string;
  MANUFACTURER_NAME?: string;
  PURCHASE_DATE?: string;
  BATTERY_EXPIRY_DATE?: string;
  ELECTRODE_EXPIRY_DATE?: string;
  CHILD_ELECTRODE_EXPIRY_DATE?: string;
  BATTERY_OK?: RegistryBoolean;
  CHILD_MODE?: RegistryBoolean;
  ACTIVE?: RegistryBoolean;
  ASSET_STATUS?: string;
  ACTIVE_DATE_LIMITED?: RegistryBoolean;
  ACTIVE_FROM_DATE?: string;
  ACTIVE_TO_DATE?: string;
  OPENING_HOURS_TEXT?: string;
  OPENING_HOURS_CLOSED_HOLIDAYS?: RegistryBoolean;
  OPENING_HOURS_LIMITED?: RegistryBoolean;
  OPENING_HOURS_MON_FROM?: number;
  OPENING_HOURS_MON_TO?: number;
  OPENING_HOURS_TUE_FROM?: number;
  OPENING_HOURS_TUE_TO?: number;
  OPENING_HOURS_WED_FROM?: number;
  OPENING_HOURS_WED_TO?: number;
  OPENING_HOURS_THU_FROM?: number;
  OPENING_HOURS_THU_TO?: number;
  OPENING_HOURS_FRI_FROM?: number;
  OPENING_HOURS_FRI_TO?: number;
  OPENING_HOURS_SAT_FROM?: number;
  OPENING_HOURS_SAT_TO?: number;
  OPENING_HOURS_SUN_FROM?: number;
  OPENING_HOURS_SUN_TO?: number;
  SITE_LATITUDE?: number;
  SITE_LONGITUDE?: number;
  SITE_NAME?: string;
  SITE_ADDRESS?: string;
  SITE_FLOOR_NUMBER?: number;
  SITE_POST_CODE?: string;
  SITE_POST_AREA?: string;
  SITE_DESCRIPTION?: string;
  SITE_ACCESS_INFO?: string;
  CREATED_DATE?: string;
  MODIFIED_DATE?: string;
  IS_OPEN?: RegistryBoolean;
  IS_OPEN_DATE?: string;
  DELETED_SINCE?: string;
  ACTIVE_MODIFIED_DATE?: string;
  OWNER_USER_ID?: number;
  [key: string]: unknown;
}

export interface AssetReference {
  ASSET_ID: number;
  ASSET_GUID: string;
  OWNER_USER_ID?: number;
}

export interface AssetListResponse extends ApiSuccessResponse {
  ASSETS: RegistryAsset[];
}

export interface AssetMutationResponse extends ApiSuccessResponse {
  ASSET?: AssetReference;
}

export type ApiMessageResponse = ApiSuccessResponse;

export interface SearchAssetsParams {
  max_rows?: number;
  from_row?: number;
  to_row?: number;
  updated_since?: DateInput;
  latitude?: number;
  longitude?: number;
  distance?: number;
  date?: DateInput;
}

export interface SinceDateParams {
  since_date?: DateInput;
}

export type RegistryBooleanInput = boolean | RegistryBoolean;

export interface AssetUpsertPayload {
  serial_number?: string;
  site_name?: string;
  site_latitude?: number;
  site_longitude?: number;
  site_address?: string;
  site_floor_number?: number;
  site_post_code?: string;
  site_post_area?: string;
  site_description?: string;
  site_access_info?: string;
  asset_type_name?: string;
  manufacturer_name?: string;
  purchase_date?: DateInput;
  battery_expiry_date?: DateInput;
  electrode_expiry_date?: DateInput;
  child_mode?: RegistryBooleanInput;
  child_electrode_expiry_date?: DateInput;
  battery_ok?: RegistryBooleanInput;
  active_date_limited?: RegistryBooleanInput;
  active_from_date?: DateInput;
  active_to_date?: DateInput;
  opening_hours_closed_holidays?: RegistryBooleanInput;
  opening_hours_limited?: RegistryBooleanInput;
  opening_hours_mon_from?: number;
  opening_hours_mon_to?: number;
  opening_hours_tue_from?: number;
  opening_hours_tue_to?: number;
  opening_hours_wed_from?: number;
  opening_hours_wed_to?: number;
  opening_hours_thu_from?: number;
  opening_hours_thu_to?: number;
  opening_hours_fri_from?: number;
  opening_hours_fri_to?: number;
  opening_hours_sat_from?: number;
  opening_hours_sat_to?: number;
  opening_hours_sun_from?: number;
  opening_hours_sun_to?: number;
}

export interface CreateMessagePayload {
  message_title: string;
  message_body: string;
  send_via?: SendVia;
}

export interface HjertestarterregisterApiClientOptions {
  baseUrl?: string;
  oauthTokenUrl?: string;
  clientId: string;
  clientSecret: string;
}
