// https://wiki.openstreetmap.org/wiki/Tag:emergency%3Ddefibrillator
export interface AedTags {
  emergency: "defibrillator";
  name?: string;
  opening_hours?: string;
  access?: "yes" | "no" | "customers" | "permissive" | "private";
  phone?: `+47 ${string}`;
  "emergency:phone": "113";
  "defibrillator:location"?: string;
  "defibrillator:code"?: string;
  indoor?: "yes" | "no";
  locked?: "yes" | "no";
  level?: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  "defibrillator:cabinet"?: string;
  "defibrillator:cabinet:manufacturer"?: string;
  "defibrillator:cabinet:colour"?: string;
  "ref:hjertestarterregister"?: string;
}
