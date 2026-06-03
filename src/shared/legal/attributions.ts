export interface Attribution {
  name: string;
  version?: string;
  license: string;
  url: string;
  copyright?: string;
}

export const THIRD_PARTY_ATTRIBUTIONS: Attribution[] = [
  {
    name: 'Mapbox Maps SDK for React Native',
    version: '10.2.10',
    license: 'Mapbox Terms of Service',
    url: 'https://www.mapbox.com/legal/tos',
    copyright: 'Copyright (c) Mapbox, Inc.',
  },
  {
    name: 'OpenStreetMap',
    license: 'Open Data Commons Open Database License (ODbL)',
    url: 'https://www.openstreetmap.org/copyright',
    copyright: '(c) OpenStreetMap contributors',
  },
  {
    name: 'TomTom Routing API',
    license: 'TomTom Developer Terms',
    url: 'https://developer.tomtom.com/terms-and-conditions',
    copyright: 'Copyright (c) TomTom N.V.',
  },
  {
    name: 'React Native',
    version: '0.84.0',
    license: 'MIT',
    url: 'https://github.com/facebook/react-native/blob/main/LICENSE',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
  },
  {
    name: 'React',
    license: 'MIT',
    url: 'https://github.com/facebook/react/blob/main/LICENSE',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
  },
  {
    name: 'Zustand',
    license: 'MIT',
    url: 'https://github.com/pmndrs/zustand/blob/main/LICENSE',
    copyright: 'Copyright (c) 2019 Paul Henschel',
  },
  {
    name: 'TanStack Query',
    license: 'MIT',
    url: 'https://github.com/TanStack/query/blob/main/LICENSE',
    copyright: 'Copyright (c) 2021 Tanner Linsley',
  },
  {
    name: 'react-native-ble-plx',
    license: 'Apache 2.0',
    url: 'https://github.com/dotintent/react-native-ble-plx/blob/master/LICENSE',
    copyright: 'Copyright (c) Polidea',
  },
  {
    name: 'OpenAI GPT-4o',
    license: 'OpenAI Terms of Use',
    url: 'https://openai.com/policies/terms-of-use',
    copyright: 'Copyright (c) OpenAI, L.L.C.',
  },
  {
    name: 'Google Gemini 2.0 Flash',
    license: 'Google Terms of Service',
    url: 'https://policies.google.com/terms',
    copyright: 'Copyright (c) Google LLC.',
  },
];

export const APP_COPYRIGHT = 'Copyright \u00a9 2026 TruckExpoAI. All rights reserved.';
export const MAP_ATTRIBUTION = 'Map data \u00a9 Mapbox \u00a9 OpenStreetMap contributors';
