// Fixed control messages use generated JSON Schema validators and DTOs.
// Binary CAD transport remains cad_protocol.fbs.
import { z } from 'zod';
import validators from './generated/session-validators.js';
import type * as DTO from './generated/session-dtos.js';
export type { SelectionEvent } from './generated/session-dtos.js';
import { CONTROL_METHODS, QUERY_METHODS_CONTRACT, SESSION_DTO_NAMES } from './generated/session-metadata.js';
export * from './generated/session-metadata.js';
export type { PairParams, AuthenticateParams, PairReply, AuthenticateReply, HelloParams, SnapshotParams, RequestMeshLODParams, RequestPreviewMeshParams, PreviewMeshHeader, MeshHeader, MeshReply, InvokeParams, NamedCommandParams, TxnParams, ErrorReply, RequestMetadata } from './generated/session-dtos.js';
export type ControlMethod = (typeof CONTROL_METHODS)[number];
export type { SessionInfoPayload } from './generated/session-dtos.js';
export const SessionInfoPayloadSchema = schema<DTO.SessionInfoPayload>('SessionInfoPayload');
export type QueryMethodContract = (typeof QUERY_METHODS_CONTRACT)[number];

function schema<T>(name: (typeof SESSION_DTO_NAMES)[number]): z.ZodType<T> {
  return z.custom<T>(value => validators[name](value), { message: 'Invalid session control ' + name });
}
export const StableFeatureIdSchema = schema<string>('StableFeatureId');
export const DatumDescriptorSchema = schema<DTO.DatumDescriptor>('DatumDescriptor');
export const SketchPlaneFrameSchema = schema<DTO.SketchPlaneFrame>('SketchPlaneFrame');
export type { DatumDescriptor, SketchPlaneFrame, DatumPlaneGeometry, DatumAxisGeometry, DatumPointGeometry } from './generated/session-dtos.js';
export const RequestMetadataSchema = schema<DTO.RequestMetadata>('RequestMetadata');
export const HelloParamsSchema = schema<DTO.HelloParams>('HelloParams');
export const PairParamsSchema = schema<DTO.PairParams>('PairParams');
export const AuthenticateParamsSchema = schema<DTO.AuthenticateParams>('AuthenticateParams');
export const SnapshotParamsSchema = schema<DTO.SnapshotParams>('SnapshotParams');
export const RequestMeshLODParamsSchema = schema<DTO.RequestMeshLODParams>('RequestMeshLODParams');
export const RequestPreviewMeshParamsSchema = schema<DTO.RequestPreviewMeshParams>('RequestPreviewMeshParams');
export const PreviewMeshHeaderSchema = schema<DTO.PreviewMeshHeader>('PreviewMeshHeader');
export const MeshHeaderSchema = schema<DTO.MeshHeader>('MeshHeader');
export const MeshReplySchema = schema<DTO.MeshReply>('MeshReply');
export const InvokeParamsSchema = schema<DTO.InvokeParams>('InvokeParams');
export const NamedCommandParamsSchema = schema<DTO.NamedCommandParams>('NamedCommandParams');
export const TxnParamsSchema = schema<DTO.TxnParams>('TxnParams');
export const ErrorReplySchema = schema<DTO.ErrorReply>('ErrorReply');
export const SessionRequestEnvelopeSchema = schema<DTO.SessionRequestEnvelope>('SessionRequestEnvelope');
export const SessionSnapshotPayloadSchema = schema<DTO.SessionSnapshotPayload>('SessionSnapshotPayload');
export const SessionIncrementalEventSchema = schema<DTO.SessionIncrementalEvent>('SessionIncrementalEvent');
export const SelectionEventSchema = schema<DTO.SelectionEvent>('SelectionEvent');
