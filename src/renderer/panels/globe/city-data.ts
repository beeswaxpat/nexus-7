// Night-side city lights for the globe: [lon, lat, weight 0..1]. Weight scales
// the glow (metro population, roughly). Hand-picked world cities, ~90 entries,
// enough that the dark hemisphere reads as the familiar "Earth at night" without
// a texture. Unit vectors are precomputed once in globe.ts.

export const CITIES: Array<[number, number, number]> = [
  // North America
  [-74.0, 40.7, 1.0], // New York
  [-118.2, 34.1, 0.95], // Los Angeles
  [-87.6, 41.9, 0.8], // Chicago
  [-95.4, 29.8, 0.6], // Houston
  [-96.8, 32.8, 0.6], // Dallas
  [-112.1, 33.4, 0.5], // Phoenix
  [-122.4, 37.8, 0.7], // San Francisco
  [-122.3, 47.6, 0.5], // Seattle
  [-80.2, 25.8, 0.6], // Miami
  [-84.4, 33.7, 0.55], // Atlanta
  [-77.0, 38.9, 0.6], // Washington
  [-71.1, 42.4, 0.55], // Boston
  [-104.9, 39.7, 0.45], // Denver
  [-90.2, 38.6, 0.35], // St Louis
  [-79.4, 43.7, 0.7], // Toronto
  [-73.6, 45.5, 0.55], // Montreal
  [-123.1, 49.3, 0.45], // Vancouver
  [-99.1, 19.4, 0.95], // Mexico City
  [-103.3, 20.7, 0.45], // Guadalajara
  [-100.3, 25.7, 0.4], // Monterrey
  [-90.5, 14.6, 0.3], // Guatemala City
  [-82.4, 23.1, 0.35], // Havana
  // South America
  [-46.6, -23.5, 1.0], // Sao Paulo
  [-43.2, -22.9, 0.8], // Rio de Janeiro
  [-58.4, -34.6, 0.85], // Buenos Aires
  [-77.0, -12.0, 0.6], // Lima
  [-74.1, 4.7, 0.6], // Bogota
  [-70.6, -33.4, 0.55], // Santiago
  [-66.9, 10.5, 0.4], // Caracas
  [-47.9, -15.8, 0.4], // Brasilia
  [-38.5, -3.7, 0.35], // Fortaleza
  [-34.9, -8.1, 0.3], // Recife
  [-56.2, -34.9, 0.3], // Montevideo
  // Europe
  [-0.1, 51.5, 1.0], // London
  [2.35, 48.9, 0.95], // Paris
  [-3.7, 40.4, 0.7], // Madrid
  [2.2, 41.4, 0.55], // Barcelona
  [12.5, 41.9, 0.65], // Rome
  [9.2, 45.5, 0.55], // Milan
  [13.4, 52.5, 0.7], // Berlin
  [8.7, 50.1, 0.5], // Frankfurt
  [11.6, 48.1, 0.4], // Munich
  [4.9, 52.4, 0.5], // Amsterdam
  [4.35, 50.85, 0.4], // Brussels
  [16.4, 48.2, 0.45], // Vienna
  [21.0, 52.2, 0.45], // Warsaw
  [18.1, 59.3, 0.4], // Stockholm
  [10.75, 59.9, 0.3], // Oslo
  [12.6, 55.7, 0.35], // Copenhagen
  [24.9, 60.2, 0.3], // Helsinki
  [37.6, 55.8, 0.95], // Moscow
  [30.3, 59.9, 0.6], // St Petersburg
  [28.95, 41.0, 0.9], // Istanbul
  [23.7, 38.0, 0.45], // Athens
  [-9.1, 38.7, 0.4], // Lisbon
  [-6.3, 53.3, 0.35], // Dublin
  [30.5, 50.45, 0.4], // Kyiv
  [26.1, 44.4, 0.35], // Bucharest
  // Africa + Middle East
  [31.2, 30.0, 0.9], // Cairo
  [3.4, 6.5, 0.85], // Lagos
  [28.0, -26.2, 0.6], // Johannesburg
  [18.4, -33.9, 0.4], // Cape Town
  [36.8, -1.3, 0.45], // Nairobi
  [38.7, 9.0, 0.4], // Addis Ababa
  [32.6, 15.6, 0.3], // Khartoum
  [-7.6, 33.6, 0.4], // Casablanca
  [3.1, 36.7, 0.35], // Algiers
  [15.3, -4.3, 0.45], // Kinshasa
  [-17.4, 14.7, 0.25], // Dakar
  [39.2, -6.8, 0.3], // Dar es Salaam
  [55.3, 25.2, 0.7], // Dubai
  [46.7, 24.7, 0.6], // Riyadh
  [51.4, 35.7, 0.8], // Tehran
  [44.4, 33.3, 0.5], // Baghdad
  [34.8, 32.1, 0.4], // Tel Aviv
  [39.8, 21.4, 0.35], // Mecca
  [35.5, 33.9, 0.3], // Beirut
  // South + Central Asia
  [77.2, 28.6, 1.0], // Delhi
  [72.9, 19.1, 1.0], // Mumbai
  [88.4, 22.6, 0.8], // Kolkata
  [80.3, 13.1, 0.6], // Chennai
  [77.6, 13.0, 0.6], // Bengaluru
  [78.5, 17.4, 0.55], // Hyderabad
  [67.0, 24.9, 0.85], // Karachi
  [74.3, 31.5, 0.7], // Lahore
  [90.4, 23.7, 0.85], // Dhaka
  [69.2, 41.3, 0.35], // Tashkent
  [85.3, 27.7, 0.3], // Kathmandu
  [79.9, 6.9, 0.3], // Colombo
  // East + Southeast Asia
  [116.4, 39.9, 1.0], // Beijing
  [121.5, 31.2, 1.0], // Shanghai
  [113.3, 23.1, 0.9], // Guangzhou
  [114.1, 22.5, 0.85], // Shenzhen
  [104.1, 30.6, 0.6], // Chengdu
  [106.5, 29.6, 0.55], // Chongqing
  [114.3, 30.6, 0.5], // Wuhan
  [108.9, 34.3, 0.45], // Xi'an
  [117.2, 39.1, 0.5], // Tianjin
  [114.2, 22.3, 0.8], // Hong Kong
  [121.5, 25.0, 0.6], // Taipei
  [139.7, 35.7, 1.0], // Tokyo
  [135.5, 34.7, 0.85], // Osaka
  [130.4, 33.6, 0.4], // Fukuoka
  [141.35, 43.1, 0.3], // Sapporo
  [126.98, 37.6, 0.9], // Seoul
  [129.1, 35.2, 0.45], // Busan
  [100.5, 13.75, 0.85], // Bangkok
  [106.7, 10.8, 0.7], // Ho Chi Minh City
  [105.85, 21.0, 0.5], // Hanoi
  [101.7, 3.15, 0.55], // Kuala Lumpur
  [103.8, 1.35, 0.7], // Singapore
  [106.8, -6.2, 0.95], // Jakarta
  [121.0, 14.6, 0.85], // Manila
  [96.2, 16.8, 0.35], // Yangon
  [106.9, 47.9, 0.2], // Ulaanbaatar
  // Oceania
  [151.2, -33.9, 0.6], // Sydney
  [145.0, -37.8, 0.6], // Melbourne
  [153.0, -27.5, 0.4], // Brisbane
  [115.9, -31.95, 0.35], // Perth
  [174.8, -36.9, 0.3], // Auckland
  [-157.9, 21.3, 0.25] // Honolulu
];
