import { Static, Type, TSchema } from '@sinclair/typebox';
import { fetch } from '@tak-ps/etl';
import ETL, { Event, SchemaType, handler as internal, local, InvocationType, DataFlowType, InputFeatureCollection } from '@tak-ps/etl';

// AIS ship type to CoT type mapping
const AIS_TYPE_TO_COT: Record<number, { type: string; icon?: string }> = {
    // 20-29: Wing in ground (WIG)
    20: { type: 'a-f-S-X' }, // Wing in ground
    21: { type: 'a-f-S-X' }, // Wing in ground, Hazmat A
    22: { type: 'a-f-S-X' }, // Wing in ground, Hazmat B
    23: { type: 'a-f-S-X' }, // Wing in ground, Hazmat C
    24: { type: 'a-f-S-X' }, // Wing in ground, Hazmat D
    29: { type: 'a-f-S-X' }, // Wing in ground, No additional info
    
    // 30-39: Fishing and special vessels
    30: { type: 'a-f-S-X-F' }, // Fishing
    31: { type: 'a-f-S-X-M-T-O' }, // Towing
    32: { type: 'a-f-S-X-M-T-O' }, // Towing (large)
    33: { type: 'a-f-S-X-F-D-R' }, // Dredging/underwater ops
    34: { type: 'a-f-U-N-D' }, // Diving ops
    35: { type: 'a-f-S' }, // Military ops
    36: { type: 'a-n-S-X-R' }, // Sailing
    37: { type: 'a-n-S-X-R' }, // Pleasure Craft
    
    // 40-49: High speed craft (HSC)
    40: { type: 'a-f-S-X-H' }, // High speed craft
    41: { type: 'a-f-S-X-H' }, // HSC, Hazmat A
    42: { type: 'a-f-S-X-H' }, // HSC, Hazmat B
    43: { type: 'a-f-S-X-H' }, // HSC, Hazmat C
    44: { type: 'a-f-S-X-H' }, // HSC, Hazmat D
    49: { type: 'a-f-S-X-H' }, // HSC, No additional info
    
    // 50-59: Special craft
    50: { type: 'a-f-S-N-S' }, // Pilot Vessel
    51: { type: 'a-f-S-N-N-R' }, // Search and Rescue vessel
    52: { type: 'a-f-S-X-M-T-U' }, // Tug
    53: { type: 'a-f-S-X' }, // Port Tender
    54: { type: 'a-f-S-X' }, // Anti-pollution equipment
    55: { type: 'a-f-S-X-L' }, // Law Enforcement
    56: { type: 'a-f-S-X-M' }, // Spare - Local Vessel
    57: { type: 'a-f-S-X-M' }, // Spare - Local Vessel
    58: { type: 'a-f-S-N-M' }, // Medical Transport
    59: { type: 'a-f-S-X-M' }, // Noncombatant ship
    
    // 60-69: Passenger
    60: { type: 'a-f-S-X-M-P' }, // Passenger
    61: { type: 'a-f-S-X-M-P' }, // Passenger, Hazmat A
    62: { type: 'a-f-S-X-M-P' }, // Passenger, Hazmat B
    63: { type: 'a-f-S-X-M-P' }, // Passenger, Hazmat C
    64: { type: 'a-f-S-X-M-P' }, // Passenger, Hazmat D
    69: { type: 'a-f-S-X-M-P' }, // Passenger, No additional info
    
    // 70-79: Cargo
    70: { type: 'a-f-S-X-M-C' }, // Cargo
    71: { type: 'a-f-S-X-M-C' }, // Cargo, Hazmat A
    72: { type: 'a-f-S-X-M-C' }, // Cargo, Hazmat B
    73: { type: 'a-f-S-X-M-C' }, // Cargo, Hazmat C
    74: { type: 'a-f-S-X-M-C' }, // Cargo, Hazmat D
    79: { type: 'a-f-S-X-M-C' }, // Cargo, No additional info
    
    // 80-89: Tanker
    80: { type: 'a-f-S-X-M-O' }, // Tanker
    81: { type: 'a-f-S-X-M-O' }, // Tanker, Hazmat A
    82: { type: 'a-f-S-X-M-O' }, // Tanker, Hazmat B
    83: { type: 'a-f-S-X-M-O' }, // Tanker, Hazmat C
    84: { type: 'a-f-S-X-M-O' }, // Tanker, Hazmat D
    89: { type: 'a-f-S-X-M-O' }, // Tanker, No additional info
    
    // 90-99: Other
    90: { type: 'a-f-S-X' }, // Other Type
    91: { type: 'a-f-S-X' }, // Other Type, Hazmat A
    92: { type: 'a-f-S-X' }, // Other Type, Hazmat B
    93: { type: 'a-f-S-X' }, // Other Type, Hazmat C
    94: { type: 'a-f-S-X' }, // Other Type, Hazmat D
    99: { type: 'a-f-S-X' } // Other Type, No additional info
};

const Env = Type.Object({
    'API_KEY': Type.String({
        description: 'AISHub API key from aishub.net'
    }),
    'BOUNDING_BOX': Type.String({
        description: 'Bounding box as minLat,maxLat,minLon,maxLon',
        default: '-48.0,-34.0,166.0,179.0'
    }),
    'API_URL': Type.String({
        description: 'Custom API URL (default: AISHub)',
        default: 'http://data.aishub.net/ws.php'
    }),
    'HOME_FLAG': Type.String({
        description: 'Home flag MID code for affiliation determination',
        default: '512'
    }),
    'VESSEL_OVERRIDES': Type.Array(Type.Object({
        MMSI: Type.Number({ description: 'MMSI number of the vessel' }),
        type: Type.Optional(Type.String({ description: 'Custom CoT type (e.g. a-f-S-X-M)' })),
        icon: Type.Optional(Type.String({ description: 'Custom icon path' })),
        comments: Type.Optional(Type.String({ description: 'Additional comments for vessel' }))
    }), {
        description: 'Vessel-specific CoT type and icon overrides by MMSI',
        default: []
    }),
    'VESSEL_PHOTO_ENABLED': Type.Boolean({
        description: 'Enable vessel photo links',
        default: false
    }),
    'VESSEL_PHOTO_API': Type.String({
        description: 'Vessel photo API endpoint URL',
        default: 'https://utils.test.tak.nz/ais-proxy/ship-photo'
    }),
    'VESSEL_PHOTO_TIMEOUT': Type.Number({
        description: 'Vessel photo API timeout in milliseconds',
        default: 2000
    }),
    'DEBUG': Type.Boolean({
        description: 'Enable debug logging',
        default: false
    })
});

const AISHubVessel = Type.Object({
    MMSI: Type.Number(),
    TIME: Type.String(),
    LONGITUDE: Type.Number(),
    LATITUDE: Type.Number(),
    COG: Type.Optional(Type.Number()),
    SOG: Type.Optional(Type.Number()),
    HEADING: Type.Optional(Type.Number()),
    NAVSTAT: Type.Optional(Type.Number()),
    IMO: Type.Optional(Type.Number()),
    NAME: Type.Optional(Type.String()),
    CALLSIGN: Type.Optional(Type.String()),
    TYPE: Type.Optional(Type.Number()),
    A: Type.Optional(Type.Number()),
    B: Type.Optional(Type.Number()),
    C: Type.Optional(Type.Number()),
    D: Type.Optional(Type.Number()),
    DRAUGHT: Type.Optional(Type.Number()),
    DEST: Type.Optional(Type.String()),
    ETA: Type.Optional(Type.String())
});

export default class Task extends ETL {
    static name = 'etl-aishub';
    static flow = [DataFlowType.Incoming];
    static invocation = [InvocationType.Schedule];

    private static readonly MILITARY_SHIP_TYPES = {
        MILITARY_OPS: 35,
        SEARCH_AND_RESCUE: 51,
        LAW_ENFORCEMENT: 55,
        MEDICAL_TRANSPORT: 58
    } as const;

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return Env;
            } else {
                return AISHubVessel;
            }
        } else {
            return Type.Object({});
        }
    }

    private getCoTTypeAndIcon(shipType?: number, mmsi?: number, overrides?: any[], homeFlag?: string): { type: string; icon?: string } {
        // Validate and sanitize MMSI input (0 is valid for coast stations)
        if (mmsi === undefined || typeof mmsi !== 'number' || mmsi < 0 || mmsi > 999999999) {
            return this.getDefaultCoTType(shipType, mmsi, homeFlag);
        }
        
        // Check for MMSI-specific override first
        if (overrides && Array.isArray(overrides)) {
            const override = overrides.find(o => 
                o && typeof o === 'object' && 
                typeof o.MMSI === 'number' && 
                o.MMSI === mmsi
            );
            if (override) {
                return {
                    type: override.type || this.getDefaultCoTType(shipType, mmsi, homeFlag),
                    icon: override.icon
                };
            }
        }
        
        return this.getDefaultCoTType(shipType, mmsi, homeFlag);
    }
    
    private determineAffiliation(shipType?: number, mmsi?: number, homeFlag?: string): string {
        if (!mmsi || !homeFlag) return 'n';
        
        const vesselMID = Math.floor(mmsi / 1000000).toString();
        if (vesselMID === homeFlag) return 'f';
        
        const militaryTypes = Object.values(Task.MILITARY_SHIP_TYPES) as number[];
        return shipType && militaryTypes.includes(shipType) ? 'u' : 'n';
    }

    private getDefaultCoTType(shipType?: number, mmsi?: number, homeFlag?: string): { type: string; icon?: string } {
        const affiliation = this.determineAffiliation(shipType, mmsi, homeFlag);
        
        if (!shipType) return { type: `a-${affiliation}-S-X` };
        
        const mapping = AIS_TYPE_TO_COT[shipType];
        if (mapping) {
            // Replace affiliation in existing mapping
            const updatedType = mapping.type.replace(/^a-[fn]-/, `a-${affiliation}-`);
            return { type: updatedType, icon: mapping.icon };
        }
        
        // 30-39: Fishing vessels
        if (shipType >= 30 && shipType <= 39) return { type: `a-${affiliation}-S-X-F` };
        // 40-49: High speed craft
        if (shipType >= 40 && shipType <= 49) return { type: `a-${affiliation}-S-X-H` };
        // 50-59: Special craft (pilot, SAR, etc.)
        if (shipType >= 50 && shipType <= 59) return { type: `a-${affiliation}-S-X-R` };
        // 60-69: Passenger vessels
        if (shipType >= 60 && shipType <= 69) return { type: `a-${affiliation}-S-X-M-P` };
        // 70-79: Cargo ships
        if (shipType >= 70 && shipType <= 79) return { type: `a-${affiliation}-S-X-M-C` };
        // 80-89: Tankers
        if (shipType >= 80 && shipType <= 89) return { type: `a-${affiliation}-S-X-M-O` };
        
        return { type: `a-${affiliation}-S-X` };
    }

    private createPhotoCheckUrl(mmsi: number, photoApiUrl: string, apiKey: string): string {
        const url = new URL(`${photoApiUrl}/${mmsi}/exists`);
        url.searchParams.append('username', apiKey);
        return url.toString();
    }

    private async fetchWithTimeout(url: string, timeoutMs: number): Promise<any> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        
        try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            return res;
        } catch {
            clearTimeout(timeout);
            return null;
        }
    }

    private async processVesselPhotos(features: any[], vessels: Static<typeof AISHubVessel>[], env: Static<typeof Env>): Promise<void> {
        const photoChecks = features.map(async (feature, i) => {
            const vessel = vessels[i];
            const hasPhoto = await this.hasRealPhoto(vessel.MMSI, env.VESSEL_PHOTO_API, env.API_KEY, env.VESSEL_PHOTO_TIMEOUT);
            
            if (hasPhoto) {
                feature.properties.links = [{
                    uid: `AIS.${vessel.MMSI}`,
                    relation: 'r-u',
                    mime: 'text/html',
                    url: `${env.VESSEL_PHOTO_API}/${vessel.MMSI}?username=${env.API_KEY}`,
                    remarks: 'Vesselfinder Picture'
                }];
            }
        });
        
        await Promise.all(photoChecks);
    }

    private async hasRealPhoto(mmsi: number, photoApiUrl: string, apiKey: string, timeoutMs: number): Promise<boolean> {
        try {
            const url = this.createPhotoCheckUrl(mmsi, photoApiUrl, apiKey);
            const res = await this.fetchWithTimeout(url, timeoutMs);
            
            if (!res?.ok) return false;
            const data = await res.json() as { exists: boolean; hasRealPhoto: boolean };
            return data.hasRealPhoto === true;
        } catch {
            return false;
        }
    }

    private getNavigationalStatusText(status?: number): string {
        const statuses: Record<number, string> = {
            0: 'Under way using engine',
            1: 'At anchor',
            2: 'Not under command',
            3: 'Restricted manoeuvrability',
            4: 'Constrained by her draught',
            5: 'Moored',
            6: 'Aground',
            7: 'Engaged in fishing',
            8: 'Under way sailing',
            15: 'Undefined'
        };
        return statuses[status || 15] || 'Undefined';
    }

    private getCountryFromMMSI(mmsi: number): string {
        const mid = Math.floor(mmsi / 1000000); // First 3 digits
        const countries: Record<number, string> = {
            201: 'Albania', 202: 'Andorra', 203: 'Austria', 204: 'Portugal (Azores)', 205: 'Belgium',
            206: 'Belarus', 207: 'Bulgaria', 208: 'Vatican', 209: 'Cyprus', 210: 'Cyprus',
            211: 'Germany', 212: 'Cyprus', 213: 'Georgia', 214: 'Moldova', 215: 'Malta',
            216: 'Armenia', 218: 'Germany', 219: 'Denmark', 220: 'Denmark', 224: 'Spain',
            225: 'Spain', 226: 'France', 227: 'France', 228: 'France', 229: 'Malta',
            230: 'Finland', 231: 'Faroe Islands', 232: 'United Kingdom', 233: 'United Kingdom',
            234: 'United Kingdom', 235: 'United Kingdom', 236: 'Gibraltar', 237: 'Greece',
            238: 'Croatia', 239: 'Greece', 240: 'Greece', 241: 'Greece', 242: 'Morocco',
            243: 'Hungary', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands',
            247: 'Italy', 248: 'Malta', 249: 'Malta', 250: 'Ireland', 251: 'Iceland',
            252: 'Liechtenstein', 253: 'Luxembourg', 254: 'Monaco', 255: 'Portugal (Madeira)',
            256: 'Malta', 257: 'Norway', 258: 'Norway', 259: 'Norway', 261: 'Poland',
            262: 'Montenegro', 263: 'Portugal', 264: 'Romania', 265: 'Sweden', 266: 'Sweden',
            267: 'Slovakia', 268: 'San Marino', 269: 'Switzerland', 270: 'Czech Republic',
            271: 'Turkey', 272: 'Ukraine', 273: 'Russia', 274: 'North Macedonia', 275: 'Latvia',
            276: 'Estonia', 277: 'Lithuania', 278: 'Slovenia', 279: 'Serbia', 301: 'Anguilla',
            303: 'Alaska', 304: 'Antigua and Barbuda', 305: 'Antigua and Barbuda', 306: 'Netherlands Antilles',
            307: 'Aruba', 308: 'Bahamas', 309: 'Bahamas', 310: 'Bermuda', 311: 'Bahamas',
            312: 'Belize', 314: 'Barbados', 316: 'Canada', 319: 'Cayman Islands', 321: 'Costa Rica',
            323: 'Cuba', 325: 'Dominica', 327: 'Dominican Republic', 329: 'Guadeloupe', 330: 'Grenada',
            331: 'Greenland', 332: 'Guatemala', 334: 'Honduras', 336: 'Haiti', 338: 'United States',
            339: 'Jamaica', 341: 'Saint Kitts and Nevis', 343: 'Saint Lucia', 345: 'Mexico',
            347: 'Martinique', 348: 'Montserrat', 350: 'Nicaragua', 351: 'Panama', 352: 'Panama',
            353: 'Panama', 354: 'Panama', 355: 'Panama', 356: 'Panama', 357: 'Panama',
            358: 'Puerto Rico', 359: 'El Salvador', 361: 'Saint Pierre and Miquelon', 362: 'Trinidad and Tobago',
            364: 'Turks and Caicos', 366: 'United States', 367: 'United States', 368: 'United States',
            369: 'United States', 370: 'Panama', 371: 'Panama', 372: 'Panama', 373: 'Panama',
            374: 'Panama', 375: 'Saint Vincent', 376: 'Saint Vincent', 377: 'Saint Vincent',
            378: 'British Virgin Islands', 379: 'United States Virgin Islands', 401: 'Afghanistan',
            403: 'Saudi Arabia', 405: 'Bangladesh', 408: 'Bahrain', 410: 'Bhutan', 412: 'China',
            413: 'China', 414: 'China', 416: 'Taiwan', 417: 'Sri Lanka', 419: 'India',
            422: 'Iran', 423: 'Azerbaijan', 425: 'Iraq', 428: 'Israel', 431: 'Japan',
            432: 'Japan', 434: 'Turkmenistan', 436: 'Kazakhstan', 437: 'Uzbekistan', 438: 'Jordan',
            440: 'South Korea', 441: 'South Korea', 443: 'Palestine', 445: 'North Korea',
            447: 'Kuwait', 450: 'Lebanon', 451: 'Kyrgyzstan', 453: 'Macao', 455: 'Maldives',
            457: 'Mongolia', 459: 'Nepal', 461: 'Oman', 463: 'Pakistan', 466: 'Qatar',
            468: 'Syria', 470: 'United Arab Emirates', 472: 'Tajikistan', 473: 'Yemen', 475: 'Yemen',
            477: 'Hong Kong', 478: 'Bosnia and Herzegovina', 501: 'Antarctica', 503: 'Australia',
            506: 'Myanmar', 508: 'Brunei', 510: 'Micronesia', 511: 'Palau', 512: 'New Zealand',
            514: 'Cambodia', 515: 'Cambodia', 516: 'Christmas Island', 518: 'Cook Islands',
            520: 'Fiji', 523: 'Cocos Islands', 525: 'Indonesia', 529: 'Kiribati', 531: 'Laos',
            533: 'Malaysia', 536: 'Northern Mariana Islands', 538: 'Marshall Islands', 540: 'New Caledonia',
            542: 'Niue', 544: 'Nauru', 546: 'French Polynesia', 548: 'Philippines', 553: 'Papua New Guinea',
            555: 'Pitcairn Island', 557: 'Solomon Islands', 559: 'American Samoa', 561: 'Samoa',
            563: 'Singapore', 564: 'Singapore', 565: 'Singapore', 566: 'Singapore', 567: 'Thailand',
            570: 'Tonga', 572: 'Tuvalu', 574: 'Vietnam', 576: 'Vanuatu', 577: 'Vanuatu',
            578: 'Wallis and Futuna', 601: 'South Africa', 603: 'Angola', 605: 'Algeria',
            607: 'Saint Paul and Amsterdam Islands', 608: 'Ascension Island', 609: 'Burundi',
            610: 'Benin', 611: 'Botswana', 612: 'Central African Republic', 613: 'Cameroon',
            615: 'Congo', 616: 'Comoros', 617: 'Cape Verde', 618: 'Crozet Archipelago',
            619: 'Ivory Coast', 620: 'Comoros', 621: 'Djibouti', 622: 'Egypt', 624: 'Ethiopia',
            625: 'Eritrea', 626: 'Gabonese Republic', 627: 'Ghana', 629: 'Gambia', 630: 'Guinea-Bissau',
            631: 'Equatorial Guinea', 632: 'Guinea', 633: 'Burkina Faso', 634: 'Kenya',
            635: 'Kerguelen Islands', 636: 'Liberia', 637: 'Liberia', 638: 'South Sudan',
            642: 'Libya', 644: 'Lesotho', 645: 'Mauritius', 647: 'Madagascar', 649: 'Mali',
            650: 'Mozambique', 654: 'Mauritania', 655: 'Malawi', 656: 'Niger', 657: 'Nigeria',
            659: 'Namibia', 660: 'Reunion', 661: 'Rwanda', 662: 'Sudan', 663: 'Senegal',
            664: 'Seychelles', 665: 'Saint Helena', 666: 'Somalia', 667: 'Sierra Leone',
            668: 'Sao Tome and Principe', 669: 'Swaziland', 670: 'Chad', 671: 'Togo',
            672: 'Tunisia', 674: 'Tanzania', 675: 'Uganda', 676: 'Democratic Republic of the Congo',
            677: 'Tanzania', 678: 'Zambia', 679: 'Zimbabwe'
        };
        return countries[mid] || 'Unknown';
    }

    private getShipTypeDescription(shipType?: number): string {
        if (!shipType) return 'Unknown';
        
        const types: Record<number, string> = {
            // 20-29: Wing in ground (WIG)
            20: 'Wing in ground (WIG)',
            21: 'Wing in ground (WIG), Hazmat A',
            22: 'Wing in ground (WIG), Hazmat B',
            23: 'Wing in ground (WIG), Hazmat C',
            24: 'Wing in ground (WIG), Hazmat D',
            25: 'Wing in ground (WIG), Reserved',
            26: 'Wing in ground (WIG), Reserved',
            27: 'Wing in ground (WIG), Reserved',
            28: 'Wing in ground (WIG), Reserved',
            29: 'Wing in ground (WIG), No additional info',
            
            // 30-39: Fishing
            30: 'Fishing',
            31: 'Towing',
            32: 'Towing (large)',
            33: 'Dredging/underwater ops',
            34: 'Diving ops',
            35: 'Military ops',
            36: 'Sailing',
            37: 'Pleasure Craft',
            38: 'Reserved',
            39: 'Reserved',
            
            // 40-49: High speed craft (HSC)
            40: 'High speed craft (HSC)',
            41: 'High speed craft (HSC), Hazmat A',
            42: 'High speed craft (HSC), Hazmat B',
            43: 'High speed craft (HSC), Hazmat C',
            44: 'High speed craft (HSC), Hazmat D',
            45: 'High speed craft (HSC), Reserved',
            46: 'High speed craft (HSC), Reserved',
            47: 'High speed craft (HSC), Reserved',
            48: 'High speed craft (HSC), Reserved',
            49: 'High speed craft (HSC), No additional info',
            
            // 50-59: Special craft
            50: 'Pilot Vessel',
            51: 'Search and Rescue vessel',
            52: 'Tug',
            53: 'Port Tender',
            54: 'Anti-pollution equipment',
            55: 'Law Enforcement',
            56: 'Spare - Local Vessel',
            57: 'Spare - Local Vessel',
            58: 'Medical Transport',
            59: 'Noncombatant ship according to RR Resolution No. 18',
            
            // 60-69: Passenger
            60: 'Passenger',
            61: 'Passenger (Hazmat A)',
            62: 'Passenger (Hazmat B)',
            63: 'Passenger (Hazmat C)',
            64: 'Passenger (Hazmat D)',
            65: 'Passenger, Reserved',
            66: 'Passenger, Reserved',
            67: 'Passenger, Reserved',
            68: 'Passenger, Reserved',
            69: 'Passenger, No additional info',
            
            // 70-79: Cargo
            70: 'Cargo',
            71: 'Cargo (Hazmat A)',
            72: 'Cargo (Hazmat B)',
            73: 'Cargo (Hazmat C)',
            74: 'Cargo (Hazmat D)',
            75: 'Cargo, Reserved',
            76: 'Cargo, Reserved',
            77: 'Cargo, Reserved',
            78: 'Cargo, Reserved',
            79: 'Cargo, No additional info',
            
            // 80-89: Tanker
            80: 'Tanker',
            81: 'Tanker (Hazmat A)',
            82: 'Tanker (Hazmat B)',
            83: 'Tanker (Hazmat C)',
            84: 'Tanker (Hazmat D)',
            85: 'Tanker, Reserved',
            86: 'Tanker, Reserved',
            87: 'Tanker, Reserved',
            88: 'Tanker, Reserved',
            89: 'Tanker, No additional info',
            
            // 90-99: Other
            90: 'Other Type',
            91: 'Other Type (Hazmat A)',
            92: 'Other Type (Hazmat B)',
            93: 'Other Type (Hazmat C)',
            94: 'Other Type (Hazmat D)',
            95: 'Other Type, Reserved',
            96: 'Other Type, Reserved',
            97: 'Other Type, Reserved',
            98: 'Other Type, Reserved',
            99: 'Other Type, No additional info'
        };
        
        return types[shipType] || `Unknown (${shipType})`;
    }

    async control() {
        const env = await this.env(Env);
        
        try {
            const coords = env.BOUNDING_BOX.split(',').map(Number);
            if (coords.length !== 4 || coords.some(isNaN) || 
                coords[0] < -90 || coords[0] > 90 || coords[1] < -90 || coords[1] > 90 ||
                coords[2] < -180 || coords[2] > 180 || coords[3] < -180 || coords[3] > 180) {
                throw new Error('Invalid BOUNDING_BOX format or values');
            }
            const [minLat, maxLat, minLon, maxLon] = coords;
            
            const url = new URL(env.API_URL);
            url.searchParams.append('username', env.API_KEY);
            url.searchParams.append('format', '1');
            url.searchParams.append('output', 'json');
            url.searchParams.append('compress', '0');
            url.searchParams.append('latmin', minLat.toString());
            url.searchParams.append('latmax', maxLat.toString());
            url.searchParams.append('lonmin', minLon.toString());
            url.searchParams.append('lonmax', maxLon.toString());

            if (env.DEBUG) {
                const sanitizedUrl = url.toString().replace(/[\r\n\t\x00-\x1f\x7f-\x9f]/g, ' ').substring(0, 200);
                console.log(`Fetching AIS data from: ${sanitizedUrl}`);
            }

            const res = await fetch(url.toString());
            
            if (!res.ok) {
                throw new Error(`AISHub API returned status ${res.status}: ${res.statusText}`);
            }

            const body = await res.json() as { ERROR?: boolean; VESSELS?: Static<typeof AISHubVessel>[] };
            
            if (body.ERROR) {
                const errorMsg = typeof body.ERROR === 'string' ? body.ERROR : 'AISHub API returned an error';
                throw new Error(`AISHub API error: ${errorMsg}`);
            }

            if (!body.VESSELS || !Array.isArray(body.VESSELS)) {
                console.log('No vessels returned from AISHub API');
                await this.submit({
                    type: 'FeatureCollection',
                    features: []
                });
                return;
            }

            console.log(`Received ${body.VESSELS.length} vessels from AISHub API`);

            const features: Static<typeof InputFeatureCollection>['features'] = [];
            
            for (const vessel of body.VESSELS) {
                const { type, icon } = this.getCoTTypeAndIcon(vessel.TYPE, vessel.MMSI, env.VESSEL_OVERRIDES, env.HOME_FLAG);
                
                // Check for custom comments from overrides
                const override = env.VESSEL_OVERRIDES.find(o => o.MMSI === vessel.MMSI);
                const customComments = override?.comments;
                
                const remarks = [
                    `MMSI: ${vessel.MMSI}`,
                    `Flag: ${this.getCountryFromMMSI(vessel.MMSI)}`,
                    vessel.NAME ? `Name: ${vessel.NAME}` : null,
                    vessel.CALLSIGN ? `Call Sign: ${vessel.CALLSIGN}` : null,
                    vessel.TYPE ? `Ship Type: ${vessel.TYPE} (${this.getShipTypeDescription(vessel.TYPE)})` : null,
                    vessel.IMO ? `IMO: ${vessel.IMO}` : null,
                    vessel.DEST ? `Destination: ${vessel.DEST}` : null,
                    vessel.NAVSTAT !== undefined ? `Status: ${this.getNavigationalStatusText(vessel.NAVSTAT)}` : null,
                    vessel.SOG !== undefined ? `Speed: ${vessel.SOG} knots` : null,
                    vessel.COG !== undefined ? `Course: ${vessel.COG}°` : null,
                    vessel.HEADING !== undefined ? `Heading: ${vessel.HEADING}°` : null,
                    vessel.DRAUGHT !== undefined ? `Draught: ${vessel.DRAUGHT}m` : null,
                    vessel.ETA ? `ETA: ${vessel.ETA}` : null,
                    customComments ? `Comments: ${customComments}` : null
                ].filter(Boolean).join('\n');

                const feature: any = {
                    id: `AIS.${vessel.MMSI}`,
                    type: 'Feature',
                    properties: {
                        type,
                        callsign: vessel.NAME || `MMSI-${vessel.MMSI}`,
                        time: new Date(vessel.TIME).toISOString(),
                        start: new Date(vessel.TIME).toISOString(),
                        course: vessel.COG || 0,
                        speed: vessel.SOG ? vessel.SOG * 0.514444 : 0,
                        remarks,
                        metadata: vessel
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [vessel.LONGITUDE, vessel.LATITUDE, 0]
                    }
                };

                if (icon) {
                    feature.properties.icon = icon;
                }

                features.push(feature);
            }

            // Check for vessel photos if enabled
            if (env.VESSEL_PHOTO_ENABLED) {
                await this.processVesselPhotos(features, body.VESSELS!, env);
            }

            const fc: Static<typeof InputFeatureCollection> = {
                type: 'FeatureCollection',
                features
            };

            console.log(`Submitting ${features.length} vessels to TAK`);
            await this.submit(fc);
            
        } catch (error) {
            if (error instanceof TypeError) {
                console.error('AISHub ETL network error: Failed to connect to API');
            } else if (error instanceof SyntaxError) {
                console.error('AISHub ETL parsing error: Invalid JSON response');
            } else {
                const sanitizedMessage = error instanceof Error ? 
                    error.message.replace(/[\r\n\t\x00-\x1f\x7f-\x9f]/g, ' ').substring(0, 200) : 
                    'Unknown error';
                console.error(`AISHub ETL error: ${sanitizedMessage}`);
            }
            await this.submit({
                type: 'FeatureCollection',
                features: []
            });
        }
    }
}

await local(new Task(), import.meta.url);

export async function handler(event: Event = {}) {
    return await internal(new Task(), event);
}

