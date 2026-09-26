// src/lib/seo.ts
//
// Structured data (schema.org JSON-LD) that tells Google, Bing and AI
// search tools exactly what Folio Forever is and sells. Prices come from
// lib/pricing + lib/magazine so they always match what checkout charges.

import { ALBUM_PRICING, type AlbumSizeKey } from './pricing'
import { MAG_PRICE, MAG_PAGE_COUNT } from './magazine/pages'
import { SHIPPING_OPTIONS } from './shipping'

export const SITE_URL = 'https://folioforever.com'
export const BRAND = 'Folio Forever'
export const CONTACT_EMAIL = 'orders@folioforever.com'

const ORG_ID = `${SITE_URL}/#organization`

export function organizationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: BRAND,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    email: CONTACT_EMAIL,
    description:
      'Custom wedding albums and wedding magazines, designed online, proofed page by page and printed to last.',
    address: { '@type': 'PostalAddress', addressRegion: 'FL', addressCountry: 'US' },
    areaServed: { '@type': 'Country', name: 'United States' },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: CONTACT_EMAIL,
      areaServed: 'US',
      availableLanguage: 'English',
    },
  }
}

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: BRAND,
    url: SITE_URL,
    publisher: { '@id': ORG_ID },
    inLanguage: 'en-US',
  }
}

export function breadcrumbLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  }
}

export function faqLd(faqs: Array<{ q: string; a: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}

/** Shipping + return details shared by every product offer. */
function offerExtras() {
  const cheapest = [...SHIPPING_OPTIONS].sort((a, b) => a.usd - b.usd)[0]
  return {
    availability: 'https://schema.org/InStock',
    priceCurrency: 'USD',
    seller: { '@id': ORG_ID },
    shippingDetails: {
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: cheapest.usd, currency: 'USD' },
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
    },
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'US',
      // Made to order: no change-of-mind returns; defects are reprinted.
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
      url: `${SITE_URL}/refunds`,
    },
  }
}

export function albumProductLd() {
  const sizes = Object.keys(ALBUM_PRICING) as AlbumSizeKey[]
  const prices = sizes.flatMap((s) => [ALBUM_PRICING[s].standard.base, ALBUM_PRICING[s].layflat.base])
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Custom Wedding Album',
    description:
      'Large-format custom wedding album, from 17×24 to 20×30 inches open, in classic book or lay-flat binding with photo, leather or acrylic covers. Designed online with Smart Auto-Layout and approved page by page before printing.',
    image: `${SITE_URL}/opengraph-image.png`,
    brand: { '@type': 'Brand', name: BRAND },
    category: 'Wedding albums',
    url: `${SITE_URL}/wedding-albums`,
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: prices.length,
      ...offerExtras(),
    },
  }
}

export function magazineProductLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Wedding Magazine',
    description: `A ${MAG_PAGE_COUNT}-page, 8.5×11 inch editorial-style wedding magazine made from your photos, in ten original design styles. Preview every page before you order.`,
    image: `${SITE_URL}/opengraph-image.png`,
    brand: { '@type': 'Brand', name: BRAND },
    category: 'Wedding keepsakes',
    url: `${SITE_URL}/wedding-magazine`,
    offers: {
      '@type': 'Offer',
      price: MAG_PRICE,
      url: `${SITE_URL}/wedding-magazine`,
      ...offerExtras(),
    },
  }
}
