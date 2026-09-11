'use client';
/**
 * Carbon Charts is client-only and heavy, so every chart loads through
 * next/dynamic with ssr:false behind a Carbon skeleton — never a spinner.
 *
 * The explicit ComponentType annotations are required: @carbon/charts-react
 * infers a `Props` type it does not export, which TypeScript cannot name
 * across a dynamic() boundary.
 */
import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { SkeletonPlaceholder } from '@carbon/react';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CarbonChartProps { data: any[]; options: any }
/* eslint-enable @typescript-eslint/no-explicit-any */

const fallback = () => <SkeletonPlaceholder style={{ width: '100%', height: '100%' }} />;

export const RadarChart: ComponentType<CarbonChartProps> = dynamic(
  () => import('@carbon/charts-react').then((m) => m.RadarChart as ComponentType<CarbonChartProps>),
  { ssr: false, loading: fallback },
);

export const TreemapChart: ComponentType<CarbonChartProps> = dynamic(
  () => import('@carbon/charts-react').then((m) => m.TreemapChart as ComponentType<CarbonChartProps>),
  { ssr: false, loading: fallback },
);
