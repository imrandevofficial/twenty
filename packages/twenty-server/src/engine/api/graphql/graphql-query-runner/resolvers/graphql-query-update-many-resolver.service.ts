import { Injectable } from '@nestjs/common';

import isEmpty from 'lodash.isempty';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';

import {
  GraphqlQueryBaseResolverService,
  GraphqlQueryResolverExecutionArgs,
} from 'src/engine/api/graphql/graphql-query-runner/interfaces/base-resolver-service';
import { ObjectRecord } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { WorkspaceQueryRunnerOptions } from 'src/engine/api/graphql/workspace-query-runner/interfaces/query-runner-option.interface';
import { UpdateManyResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import {
  GraphqlQueryRunnerException,
  GraphqlQueryRunnerExceptionCode,
} from 'src/engine/api/graphql/graphql-query-runner/errors/graphql-query-runner.exception';
import { ObjectRecordsToGraphqlConnectionHelper } from 'src/engine/api/graphql/graphql-query-runner/helpers/object-records-to-graphql-connection.helper';
import { assertIsValidUuid } from 'src/engine/api/graphql/workspace-query-runner/utils/assert-is-valid-uuid.util';
import { assertMutationNotOnRemoteObject } from 'src/engine/metadata-modules/object-metadata/utils/assert-mutation-not-on-remote-object.util';
import { formatData } from 'src/engine/twenty-orm/utils/format-data.util';
import { formatResult } from 'src/engine/twenty-orm/utils/format-result.util';
import { computeTableName } from 'src/engine/utils/compute-table-name.util';
import { getObjectMetadataFromObjectMetadataItemWithFieldMaps } from 'src/engine/metadata-modules/utils/get-object-metadata-from-object-metadata-Item-with-field-maps';

@Injectable()
export class GraphqlQueryUpdateManyResolverService extends GraphqlQueryBaseResolverService<
  UpdateManyResolverArgs,
  ObjectRecord[]
> {
  async resolve(
    executionArgs: GraphqlQueryResolverExecutionArgs<UpdateManyResolverArgs>,
  ): Promise<ObjectRecord[]> {
    const { authContext, objectMetadataItemWithFieldMaps, objectMetadataMaps } =
      executionArgs.options;

    const { roleId } = executionArgs;

    const queryBuilder = executionArgs.repository.createQueryBuilder(
      objectMetadataItemWithFieldMaps.nameSingular,
    );

    const existingRecordsBuilder = queryBuilder.clone();

    executionArgs.graphqlQueryParser.applyFilterToBuilder(
      existingRecordsBuilder,
      objectMetadataItemWithFieldMaps.nameSingular,
      executionArgs.args.filter,
    );

    const existingRecords = await existingRecordsBuilder.getMany();

    const formattedExistingRecords = formatResult<ObjectRecord[]>(
      existingRecords,
      objectMetadataItemWithFieldMaps,
      objectMetadataMaps,
    );

    if (isEmpty(formattedExistingRecords)) {
      throw new GraphqlQueryRunnerException(
        'Records not found',
        GraphqlQueryRunnerExceptionCode.RECORD_NOT_FOUND,
      );
    }

    const tableName = computeTableName(
      objectMetadataItemWithFieldMaps.nameSingular,
      objectMetadataItemWithFieldMaps.isCustom,
    );

    executionArgs.graphqlQueryParser.applyFilterToBuilder(
      queryBuilder,
      tableName,
      executionArgs.args.filter,
    );

    const data = formatData(
      executionArgs.args.data,
      objectMetadataItemWithFieldMaps,
    );

    const nonFormattedUpdatedObjectRecords = await queryBuilder
      .update(data)
      .returning('*')
      .execute();

    const formattedUpdatedRecords = formatResult<ObjectRecord[]>(
      nonFormattedUpdatedObjectRecords.raw,
      objectMetadataItemWithFieldMaps,
      objectMetadataMaps,
    );

    this.apiEventEmitterService.emitUpdateEvents({
      existingRecords: structuredClone(formattedExistingRecords),
      records: structuredClone(formattedUpdatedRecords),
      updatedFields: Object.keys(executionArgs.args.data),
      authContext,
      objectMetadataItem: getObjectMetadataFromObjectMetadataItemWithFieldMaps(
        objectMetadataItemWithFieldMaps,
      ),
    });

    if (executionArgs.graphqlQuerySelectedFieldsResult.relations) {
      await this.processNestedRelationsHelper.processNestedRelations({
        objectMetadataMaps,
        parentObjectMetadataItem: objectMetadataItemWithFieldMaps,
        parentObjectRecords: [
          ...formattedExistingRecords,
          ...formattedUpdatedRecords,
        ],
        relations: executionArgs.graphqlQuerySelectedFieldsResult.relations,
        limit: QUERY_MAX_RECORDS,
        authContext,
        workspaceDataSource: executionArgs.workspaceDataSource,
        roleId,
        shouldBypassPermissionChecks: executionArgs.isExecutedByApiKey,
      });
    }

    const typeORMObjectRecordsParser =
      new ObjectRecordsToGraphqlConnectionHelper(objectMetadataMaps);

    return formattedUpdatedRecords.map((record: ObjectRecord) =>
      typeORMObjectRecordsParser.processRecord({
        objectRecord: record,
        objectName: objectMetadataItemWithFieldMaps.nameSingular,
        take: 1,
        totalCount: 1,
      }),
    );
  }

  async validate(
    args: UpdateManyResolverArgs<Partial<ObjectRecord>>,
    options: WorkspaceQueryRunnerOptions,
  ): Promise<void> {
    assertMutationNotOnRemoteObject(options.objectMetadataItemWithFieldMaps);
    if (!args.filter) {
      throw new Error('Filter is required');
    }

    args.filter.id?.in?.forEach((id: string) => assertIsValidUuid(id));
  }
}
