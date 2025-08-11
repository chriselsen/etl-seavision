import { Static, Type, TSchema } from '@sinclair/typebox';
import { fetch } from '@tak-ps/etl';
import ETL, { Event, SchemaType, handler as internal, local, InvocationType, DataFlowType } from '@tak-ps/etl';

/**
 * AIS ship type to CoT type mapping
 * Maps AIS vessel types (20-99) to appropriate Cursor-on-Target types
 * Affiliation (a-f-/a-n-/a-u-) will be dynamically replaced based on vessel flag
 */
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

/**
 * Environment configuration schema
 * Defines all configurable parameters for the SeaVision ETL
 */
const Env = Type.Object({
    'API_KEY': Type.String({
        description: 'SeaVision API key (x-api-key header)'
    }),
    'LOCATIONS': Type.Array(Type.Object({
        latitude: Type.Number({ description: 'Latitude of search center' }),
        longitude: Type.Number({ description: 'Longitude of search center' }),
        radius: Type.Number({ description: 'Search radius in statute miles (1-100)', minimum: 1, maximum: 100 }),
        apiKey: Type.Optional(Type.String({ description: 'SeaVision API key for this location' }))
    }), {
        description: 'Array of location/radius/API key combinations to query',
        default: [{ latitude: 37.7749, longitude: -122.4194, radius: 100 }]
    }),
    'MAX_AGE_HOURS': Type.Number({
        description: 'Maximum age of vessel data in hours',
        default: 1,
        minimum: 1
    }),
    'API_URL': Type.String({
        description: 'SeaVision API URL',
        default: 'https://api.seavision.volpe.dot.gov/v1/vessels'
    }),
    'HOME_FLAGS': Type.String({
        description: 'Home flag MID codes for affiliation determination (comma-separated)',
        default: '303,338,366,367,368,369'
    }),
    'MAX_LOCATION_RUNTIME': Type.Number({
        description: 'Maximum total runtime for all location API calls in seconds',
        default: 60,
        minimum: 10
    }),
    'VESSEL_FILTERING': Type.Optional(Type.Boolean({
        description: 'Only show vessels from the VESSEL_OVERRIDES list. Useful for filtering out large amounts of vessels in an area.',
        default: false
    })),
    'SHOW_MILITARY': Type.Optional(Type.Boolean({
        description: 'Show Military ops vessels (type 35) when VESSEL_FILTERING is enabled',
        default: false
    })),
    'SHOW_SEARCH_RESCUE': Type.Optional(Type.Boolean({
        description: 'Show Search and Rescue vessels (type 51) when VESSEL_FILTERING is enabled',
        default: false
    })),
    'SHOW_LAW_ENFORCEMENT': Type.Optional(Type.Boolean({
        description: 'Show Law Enforcement vessels (type 55) when VESSEL_FILTERING is enabled',
        default: false
    })),
    'SHOW_MEDICAL': Type.Optional(Type.Boolean({
        description: 'Show Medical Transport vessels (type 58) when VESSEL_FILTERING is enabled',
        default: false
    })),
    'VESSEL_USE_OVERRIDES': Type.Optional(Type.Boolean({
        description: 'Apply vessel overrides for CoT type and icon changes, even when filtering is disabled.',
        default: true
    })),
    'VESSEL_OVERRIDES': Type.Array(Type.Object({
        MMSI: Type.Number({ description: 'MMSI number of the vessel' }),
        Name: Type.Optional(Type.String({ description: 'Custom vessel name to override AIS data' })),
        type: Type.Optional(Type.String({ description: 'Custom CoT type (e.g. a-f-S-X-M)' })),
        icon: Type.Optional(Type.String({ description: 'Custom icon path' })),
        comments: Type.Optional(Type.String({ description: 'Additional comments for vessel' }))
    }), {
        description: 'Vessel-specific CoT type and icon overrides by MMSI',
        default: []
    }),
    'DEBUG': Type.Boolean({
        description: 'Enable debug logging',
        default: false
    })
});

/**
 * SeaVision API vessel data structure
 * Defines the expected format of vessel data from the SeaVision API
 */
const SeaVisionVessel = Type.Object({
    mmsi: Type.Number(),
    imoNumber: Type.Optional(Type.Number()),
    name: Type.Optional(Type.String()),
    callSign: Type.Optional(Type.String()),
    cargo: Type.Optional(Type.String()),
    vesselType: Type.Optional(Type.String()),
    COG: Type.Optional(Type.Number()),
    heading: Type.Optional(Type.Number()),
    navStatus: Type.Optional(Type.String()),
    SOG: Type.Optional(Type.Number()),
    latitude: Type.Number(),
    longitude: Type.Number(),
    timeOfFix: Type.Optional(Type.Number()),
    length: Type.Optional(Type.Number()),
    beam: Type.Optional(Type.Number())
});

/**
 * SeaVision ETL Task
 * Fetches vessel data from SeaVision API and transforms it to CoT format
 */
export default class Task extends ETL {
    static name = 'etl-seavision';
    static flow = [DataFlowType.Incoming];
    static invocation = [InvocationType.Schedule];

    /** AIS ship types considered military for affiliation determination */
    private static readonly MILITARY_SHIP_TYPES = [35, 51, 55, 58] as const;

    /**
     * Get flag country from MMSI Maritime Identification Digits (MID)
     * @param mmsi - Maritime Mobile Service Identity number
     * @returns Country name or 'Unknown'
     */
    private getFlagCountry(mmsi?: number): string {
        if (!mmsi || typeof mmsi !== 'number') return 'Unknown';
        
        // Extract MID (first 3 digits) from MMSI
        const mid = Math.floor(mmsi / 1000000);
        
        // MID to country mapping based on ITU standards
        const midMap: Record<number, string> = {
            201: 'Albania', 202: 'Andorra', 203: 'Austria', 204: 'Azores', 205: 'Belgium',
            206: 'Belarus', 207: 'Bulgaria', 208: 'Vatican', 209: 'Cyprus', 210: 'Cyprus',
            211: 'Germany', 212: 'Cyprus', 213: 'Georgia', 214: 'Moldova', 215: 'Malta',
            216: 'Armenia', 218: 'Germany', 219: 'Denmark', 220: 'Denmark', 224: 'Spain',
            225: 'Spain', 226: 'France', 227: 'France', 228: 'France', 229: 'Malta',
            230: 'Finland', 231: 'Faroe Islands', 232: 'United Kingdom', 233: 'United Kingdom',
            234: 'United Kingdom', 235: 'United Kingdom', 236: 'Gibraltar', 237: 'Greece',
            238: 'Croatia', 239: 'Greece', 240: 'Greece', 241: 'Greece', 242: 'Morocco',
            243: 'Hungary', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands',
            247: 'Italy', 248: 'Malta', 249: 'Malta', 250: 'Ireland', 251: 'Iceland',
            252: 'Liechtenstein', 253: 'Luxembourg', 254: 'Monaco', 255: 'Madeira',
            256: 'Malta', 257: 'Norway', 258: 'Norway', 259: 'Norway', 261: 'Poland',
            262: 'Montenegro', 263: 'Portugal', 264: 'Romania', 265: 'Sweden', 266: 'Sweden',
            267: 'Slovakia', 268: 'San Marino', 269: 'Switzerland', 270: 'Czech Republic',
            271: 'Turkey', 272: 'Ukraine', 273: 'Russia', 274: 'Macedonia', 275: 'Latvia',
            276: 'Estonia', 277: 'Lithuania', 278: 'Slovenia', 279: 'Serbia', 301: 'Anguilla',
            303: 'Alaska', 304: 'Antigua and Barbuda', 305: 'Antigua and Barbuda',
            306: 'Netherlands Antilles', 307: 'Aruba', 308: 'Bahamas', 309: 'Bahamas',
            310: 'Bermuda', 311: 'Bahamas', 312: 'Belize', 314: 'Barbados', 316: 'Canada',
            319: 'Cayman Islands', 321: 'Costa Rica', 323: 'Cuba', 325: 'Dominica',
            327: 'Dominican Republic', 329: 'Guadeloupe', 330: 'Grenada', 331: 'Greenland',
            332: 'Guatemala', 334: 'Honduras', 336: 'Haiti', 338: 'United States',
            339: 'Jamaica', 341: 'Saint Kitts and Nevis', 343: 'Saint Lucia',
            345: 'Mexico', 347: 'Martinique', 348: 'Montserrat', 350: 'Nicaragua',
            351: 'Panama', 352: 'Panama', 353: 'Panama', 354: 'Panama', 355: 'Panama',
            356: 'Panama', 357: 'Panama', 358: 'Puerto Rico', 359: 'El Salvador',
            361: 'Saint Pierre and Miquelon', 362: 'Trinidad and Tobago',
            364: 'Turks and Caicos Islands', 366: 'United States', 367: 'United States',
            368: 'United States', 369: 'United States', 370: 'Panama', 371: 'Panama',
            372: 'Panama', 373: 'Panama', 374: 'Panama', 375: 'Saint Vincent and the Grenadines',
            376: 'Saint Vincent and the Grenadines', 377: 'Saint Vincent and the Grenadines',
            378: 'British Virgin Islands', 379: 'United States Virgin Islands',
            401: 'Afghanistan', 403: 'Saudi Arabia', 405: 'Bangladesh', 408: 'Bahrain',
            410: 'Bhutan', 412: 'China', 413: 'China', 414: 'China', 416: 'Taiwan',
            417: 'Sri Lanka', 419: 'India', 422: 'Iran', 423: 'Azerbaijan', 425: 'Iraq',
            428: 'Israel', 431: 'Japan', 432: 'Japan', 434: 'Turkmenistan', 436: 'Kazakhstan',
            437: 'Uzbekistan', 438: 'Jordan', 440: 'Korea', 441: 'Korea', 443: 'Palestine',
            445: 'North Korea', 447: 'Kuwait', 450: 'Lebanon', 451: 'Kyrgyzstan',
            453: 'Macao', 455: 'Maldives', 457: 'Mongolia', 459: 'Nepal', 461: 'Oman',
            463: 'Pakistan', 466: 'Qatar', 468: 'Syria', 470: 'United Arab Emirates',
            472: 'Tajikistan', 473: 'Yemen', 475: 'Yemen', 477: 'Hong Kong', 478: 'Bosnia and Herzegovina',
            501: 'Antarctica', 503: 'Australia', 506: 'Myanmar', 508: 'Brunei',
            510: 'Micronesia', 511: 'Palau', 512: 'New Zealand', 514: 'Cambodia',
            515: 'Cambodia', 516: 'Christmas Island', 518: 'Cook Islands', 520: 'Fiji',
            523: 'Cocos Islands', 525: 'Indonesia', 529: 'Kiribati', 531: 'Laos',
            533: 'Malaysia', 536: 'Northern Mariana Islands', 538: 'Marshall Islands',
            540: 'New Caledonia', 542: 'Niue', 544: 'Nauru', 546: 'French Polynesia',
            548: 'Philippines', 553: 'Papua New Guinea', 555: 'Pitcairn Island',
            557: 'Solomon Islands', 559: 'American Samoa', 561: 'Samoa', 563: 'Singapore',
            564: 'Singapore', 565: 'Singapore', 566: 'Singapore', 567: 'Thailand',
            570: 'Tonga', 572: 'Tuvalu', 574: 'Vietnam', 576: 'Vanuatu', 577: 'Vanuatu',
            578: 'Wallis and Futuna', 601: 'South Africa', 603: 'Angola', 605: 'Algeria',
            607: 'Saint Paul and Amsterdam Islands', 608: 'Ascension Island', 609: 'Burundi',
            610: 'Benin', 611: 'Botswana', 612: 'Central African Republic', 613: 'Cameroon',
            615: 'Congo', 616: 'Comoros', 617: 'Cape Verde', 618: 'Antarctica',
            619: 'Ivory Coast', 620: 'Comoros', 621: 'Djibouti', 622: 'Egypt',
            624: 'Ethiopia', 625: 'Eritrea', 626: 'Gabonese Republic', 627: 'Ghana',
            629: 'Gambia', 630: 'Guinea-Bissau', 631: 'Equatorial Guinea', 632: 'Guinea',
            633: 'Burkina Faso', 634: 'Kenya', 635: 'Antarctica', 636: 'Liberia',
            637: 'Liberia', 638: 'South Sudan', 642: 'Libya', 644: 'Lesotho',
            645: 'Mauritius', 647: 'Madagascar', 649: 'Mali', 650: 'Mozambique',
            654: 'Mauritania', 655: 'Malawi', 656: 'Niger', 657: 'Nigeria',
            659: 'Namibia', 660: 'Reunion', 661: 'Rwanda', 662: 'Sudan', 663: 'Senegal',
            664: 'Seychelles', 665: 'Saint Helena', 666: 'Somalia', 667: 'Sierra Leone',
            668: 'Sao Tome and Principe', 669: 'Swaziland', 670: 'Chad', 671: 'Togo',
            672: 'Tunisia', 674: 'Tanzania', 675: 'Uganda', 676: 'Democratic Republic of the Congo',
            677: 'Tanzania', 678: 'Zambia', 679: 'Zimbabwe'
        };
        
        return midMap[mid] || 'Unknown';
    }

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            return type === SchemaType.Input ? Env : SeaVisionVessel;
        }
        return Type.Object({});
    }

    /**
     * Get CoT type and icon for a vessel, applying overrides if configured
     * @param shipType - AIS ship type number
     * @param mmsi - Maritime Mobile Service Identity
     * @param overrides - Array of vessel-specific overrides
     * @param homeFlags - Comma-separated home flag MID codes
     * @param useOverrides - Whether to apply vessel overrides
     * @returns CoT type and optional icon
     */
    private getCoTTypeAndIcon(shipType?: number, mmsi?: number, overrides?: any[], homeFlags?: string, useOverrides?: boolean): { type: string; icon?: string } {
        // Validate and sanitize MMSI input (0 is valid for coast stations)
        if (mmsi === undefined || typeof mmsi !== 'number' || mmsi < 0 || mmsi > 999999999) {
            return this.getDefaultCoTType(shipType, undefined, homeFlags);
        }
        
        // Check for MMSI-specific override first if enabled
        if (useOverrides && overrides && Array.isArray(overrides)) {
            try {
                const override = overrides.find(o => 
                    o && typeof o === 'object' && 
                    typeof o.MMSI === 'number' && 
                    o.MMSI === mmsi
                );
                if (override && override.type) {
                    return {
                        type: override.type,
                        icon: override.icon
                    };
                } else if (override) {
                    const defaultType = this.getDefaultCoTType(shipType, mmsi, homeFlags);
                    return {
                        type: defaultType.type,
                        icon: override.icon || defaultType.icon
                    };
                }
            } catch (error) {
                console.error('Error processing vessel override:', error);
            }
        }
        
        return this.getDefaultCoTType(shipType, mmsi, homeFlags);
    }
    
    /**
     * Determine vessel affiliation based on flag and military status
     * @param shipType - AIS ship type number
     * @param mmsi - Maritime Mobile Service Identity
     * @param homeFlags - Comma-separated home flag MID codes
     * @returns Affiliation code: 'f' (friendly), 'u' (unknown), 'n' (neutral)
     */
    private determineAffiliation(shipType?: number, mmsi?: number, homeFlags?: string): string {
        if (!mmsi || !homeFlags) return 'n';
        
        // Extract MID and check against home flags
        const vesselMID = Math.floor(mmsi / 1000000).toString();
        const homeFlagsArray = homeFlags.split(',').map(f => f.trim());
        const isHomeFlagged = homeFlagsArray.includes(vesselMID);
        const isMilitary = shipType && (Task.MILITARY_SHIP_TYPES as readonly number[]).includes(shipType);
        
        // Home-flagged vessels are always friendly, regardless of military status
        if (isHomeFlagged) return 'f';
        
        // Foreign vessels: military = unknown, civilian = neutral
        return isMilitary ? 'u' : 'n';
    }



    private getDefaultCoTType(shipType?: number, mmsi?: number, homeFlags?: string): { type: string; icon?: string } {
        const affiliation = this.determineAffiliation(shipType, mmsi, homeFlags);
        
        if (!shipType) return { type: `a-${affiliation}-S-X` };
        
        const mapping = AIS_TYPE_TO_COT[shipType];
        if (mapping) {
            const updatedType = mapping.type.replace(/^a-[fnu]-/, `a-${affiliation}-`);
            return { type: updatedType, icon: mapping.icon };
        }
        
        // Check ship type ranges
        if (shipType >= 30 && shipType <= 39) return { type: `a-${affiliation}-S-X-F` };
        if (shipType >= 40 && shipType <= 49) return { type: `a-${affiliation}-S-X-H` };
        if (shipType >= 50 && shipType <= 59) return { type: `a-${affiliation}-S-X-R` };
        if (shipType >= 60 && shipType <= 69) return { type: `a-${affiliation}-S-X-M-P` };
        if (shipType >= 70 && shipType <= 79) return { type: `a-${affiliation}-S-X-M-C` };
        if (shipType >= 80 && shipType <= 89) return { type: `a-${affiliation}-S-X-M-O` };
        
        return { type: `a-${affiliation}-S-X` };
    }
    private getNavigationalStatusText(status?: number): string {
        const statusMap: Record<number, string> = {
            0: 'Under way using engine',
            1: 'At anchor',
            2: 'Not under command',
            3: 'Restricted manoeuvrability',
            4: 'Constrained by her draught',
            5: 'Moored',
            6: 'Aground',
            7: 'Engaged in fishing',
            8: 'Under way sailing',
            9: 'Reserved for future amendment',
            10: 'Reserved for future amendment',
            11: 'Power-driven vessel towing astern',
            12: 'Power-driven vessel pushing ahead',
            13: 'Reserved for future use',
            14: 'AIS-SART',
            15: 'Undefined'
        };
        
        return statusMap[status || 15] || 'Unknown';
    }
    /**
     * Main control method - processes all configured locations sequentially
     * Queries SeaVision API for each location and submits results immediately
     */
    async control(): Promise<void> {
        const env = await this.env(Env);
        
        // Calculate delay between location queries to stay within runtime limit
        const delay = env.LOCATIONS.length > 1 ? Math.min(env.MAX_LOCATION_RUNTIME * 1000 / env.LOCATIONS.length, env.MAX_LOCATION_RUNTIME * 1000) : 0;
        
        // Create lookup map for vessel overrides for efficient filtering
        const overridesMap = new Map();
        for (const override of env.VESSEL_OVERRIDES) {
            if (override.MMSI) {
                overridesMap.set(override.MMSI, override);
            }
        }
        
        // Process each location sequentially with delays between calls
        for (let i = 0; i < env.LOCATIONS.length; i++) {
            const location = env.LOCATIONS[i];
            
            try {
                const url = new URL(env.API_URL);
                url.searchParams.set('latitude', location.latitude.toString());
                url.searchParams.set('longitude', location.longitude.toString());
                url.searchParams.set('radius', location.radius.toString());
                
                if (env.DEBUG) {
                    console.log(`Querying SeaVision API: ${url.toString()}`);
                }
                
                const response = await fetch(url.toString(), {
                    headers: {
                        'x-api-key': location.apiKey || env.API_KEY
                    }
                });
                
                if (!response.ok) {
                    if (response.status === 429) {
                        console.log('SeaVision API rate limit reached. Will retry on next invocation.');
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const vessels = await response.json();
                if (!Array.isArray(vessels)) {
                    if (env.DEBUG) {
                        console.warn('API response is not an array:', typeof vessels);
                    }
                    continue;
                }
                
                // Filter vessels by age - only include recent position reports
                const maxAgeMs = env.MAX_AGE_HOURS * 60 * 60 * 1000;
                const now = Date.now();
                const filteredVessels = vessels.filter((vessel: any) => {
                    if (!vessel.timeOfFix) return true; // Include vessels without timestamp
                    const vesselTime = parseInt(vessel.timeOfFix) * 1000;
                    return (now - vesselTime) <= maxAgeMs;
                });
                
                // Transform vessels to features
                const features = filteredVessels.reduce((acc: any[], vessel: any) => {
                    try {
                        const feature = this.transformVesselToFeature(vessel, env);
                        
                        // Apply vessel filtering if enabled
                        if (env.VESSEL_FILTERING === true) {
                            const mmsi = feature.properties.metadata?.mmsi;
                            const vesselType = this.parseVesselType(vessel.vesselType);
                            
                            // Check if vessel is in overrides list (always shown if present)
                            const inOverrides = mmsi && overridesMap.has(mmsi);
                            
                            // Check if vessel type is specifically enabled
                            const typeEnabled = (
                                (vesselType === 35 && env.SHOW_MILITARY) ||      // Military ops
                                (vesselType === 51 && env.SHOW_SEARCH_RESCUE) || // Search & Rescue
                                (vesselType === 55 && env.SHOW_LAW_ENFORCEMENT) || // Law Enforcement
                                (vesselType === 58 && env.SHOW_MEDICAL)         // Medical Transport
                            );
                            
                            // Skip vessel if not in overrides and type not enabled
                            if (!inOverrides && !typeEnabled) {
                                return acc;
                            }
                        }
                        
                        acc.push(feature);
                    } catch (error) {
                        console.error(`Error processing vessel ${vessel.mmsi}:`, error);
                    }
                    return acc;
                }, []);
                
                if (env.DEBUG) {
                    console.log(`Location ${i + 1}/${env.LOCATIONS.length}: Found ${features.length} features`);
                }
                
                // Submit results immediately for this location
                if (features.length > 0) {
                    await this.submit({
                        type: 'FeatureCollection',
                        features
                    });
                }
                
            } catch (error) {
                console.error(`Error querying location ${location.latitude},${location.longitude}:`, error);
            }
            
            // Add delay between locations (except for the last one)
            if (i < env.LOCATIONS.length - 1 && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    private transformVesselToFeature(vessel: any, env: Static<typeof Env>): any {
        if (!vessel || typeof vessel.mmsi !== 'number' || typeof vessel.latitude !== 'number' || typeof vessel.longitude !== 'number') {
            throw new Error('Invalid vessel data: missing required fields');
        }
        
        const vesselType = this.parseVesselType(vessel.vesselType);
        const navStatus = this.parseNavStatus(vessel.navStatus);
        const { type, icon } = this.getCoTTypeAndIcon(vesselType, vessel.mmsi, env.VESSEL_OVERRIDES, env.HOME_FLAGS, env.VESSEL_USE_OVERRIDES !== false);
        
        // Check for override comments and name
        let additionalComments = '';
        let vesselName = vessel.name;
        if (env.VESSEL_USE_OVERRIDES !== false && env.VESSEL_OVERRIDES) {
            const override = env.VESSEL_OVERRIDES.find(o => o.MMSI === vessel.mmsi);
            if (override) {
                if (override.comments) {
                    additionalComments = override.comments;
                }
                if (override.Name) {
                    vesselName = override.Name;
                }
            }
        }
        
        const remarks = this.buildRemarks(vessel, vesselType, navStatus, additionalComments, vesselName);
        
        const currentTime = new Date().toISOString();
        const fixTime = vessel.timeOfFix && !isNaN(parseInt(vessel.timeOfFix)) 
            ? new Date(parseInt(vessel.timeOfFix) * 1000).toISOString() 
            : currentTime;
        
        const feature: any = {
            id: `MMSI-${vessel.mmsi}`,
            type: 'Feature',
            properties: {
                type,
                callsign: vesselName || `MMSI-${vessel.mmsi}`,
                time: fixTime,
                start: fixTime,
                course: typeof vessel.COG === 'number' ? vessel.COG : 0,
                speed: typeof vessel.SOG === 'number' ? vessel.SOG * 0.514444 : 0, // Convert knots to m/s
                remarks,
                flag: this.getFlagCountry(vessel.mmsi),
                metadata: vessel
            },
            geometry: {
                type: 'Point',
                coordinates: [vessel.longitude, vessel.latitude, 0]
            }
        };
        
        if (icon) {
            feature.properties.icon = icon;
        }
        
        return feature;
    }
    
    private parseVesselType(vesselType?: string): number | undefined {
        if (!vesselType || typeof vesselType !== 'string') return undefined;
        
        // Extract numeric part from vessel type (e.g., "8-Tanker" -> 8)
        const match = vesselType.match(/^(\d+)/);
        if (match && match[1]) {
            const parsed = parseInt(match[1], 10);
            return !isNaN(parsed) ? parsed : undefined;
        }
        return undefined;
    }
    
    private parseNavStatus(navStatus?: string): number | undefined {
        if (!navStatus || typeof navStatus !== 'string') return undefined;
        
        // Extract numeric part from nav status (e.g., "0-Underway(Engine)" -> 0)
        const match = navStatus.match(/^(\d+)/);
        if (match && match[1]) {
            const parsed = parseInt(match[1], 10);
            return !isNaN(parsed) ? parsed : undefined;
        }
        return undefined;
    }
    
    private buildRemarks(vessel: any, vesselType?: number, navStatus?: number, additionalComments?: string, overrideName?: string): string {
        if (!vessel) return '';
        
        const parts: string[] = [];
        
        const displayName = overrideName || vessel.name;
        if (displayName && typeof displayName === 'string') parts.push(`Name: ${displayName}`);
        if (typeof vessel.mmsi === 'number') parts.push(`MMSI: ${vessel.mmsi}`);
        if (typeof vessel.imoNumber === 'number' && vessel.imoNumber > 0) parts.push(`IMO: ${vessel.imoNumber}`);
        if (vessel.callSign && typeof vessel.callSign === 'string') parts.push(`Call Sign: ${vessel.callSign}`);
        if (typeof vessel.mmsi === 'number') parts.push(`Flag: ${this.getFlagCountry(vessel.mmsi)}`);
        if (vesselType !== undefined) parts.push(`Type: ${this.getVesselTypeText(vesselType)}`);
        if (navStatus !== undefined) parts.push(`Status: ${this.getNavigationalStatusText(navStatus)}`);
        if (vessel.cargo && typeof vessel.cargo === 'string' && vessel.cargo !== '0-AllShips') parts.push(`Cargo: ${vessel.cargo}`);
        if (typeof vessel.length === 'number' && typeof vessel.beam === 'number') parts.push(`Dimensions: ${vessel.length}m x ${vessel.beam}m`);
        if (typeof vessel.SOG === 'number') parts.push(`Speed: ${vessel.SOG} knots`);
        if (typeof vessel.COG === 'number' && vessel.COG >= 0) parts.push(`Course: ${vessel.COG}°`);
        if (typeof vessel.heading === 'number' && vessel.heading >= 0) parts.push(`Heading: ${vessel.heading}°`);
        if (vessel.timeOfFix && !isNaN(parseInt(vessel.timeOfFix))) {
            const fixTime = new Date(parseInt(vessel.timeOfFix) * 1000);
            if (!isNaN(fixTime.getTime())) {
                parts.push(`Last Fix: ${fixTime.toISOString()}`);
            }
        }
        if (additionalComments && typeof additionalComments === 'string') parts.push(`Comments: ${additionalComments}`);
        
        return parts.join('\n');
    }
    
    private getVesselTypeText(type: number): string {
        if (type >= 20 && type <= 29) return 'Wing in Ground';
        if (type >= 30 && type <= 39) return 'Fishing/Special';
        if (type >= 40 && type <= 49) return 'High Speed Craft';
        if (type >= 50 && type <= 59) return 'Special Craft';
        if (type >= 60 && type <= 69) return 'Passenger';
        if (type >= 70 && type <= 79) return 'Cargo';
        if (type >= 80 && type <= 89) return 'Tanker';
        if (type >= 90 && type <= 99) return 'Other';
        
        const typeMap: Record<number, string> = {
            0: 'Unknown', 1: 'Reserved', 2: 'Wing in Ground', 3: 'Special Category',
            4: 'High Speed Craft', 5: 'Special Category', 6: 'Passenger',
            7: 'Cargo', 8: 'Tanker', 9: 'Other'
        };
        
        return typeMap[type] || `Type ${type}`;
    }
}

await local(new Task(), import.meta.url);

export async function handler(event: Event = {}) {
    return await internal(new Task(), event);
}

