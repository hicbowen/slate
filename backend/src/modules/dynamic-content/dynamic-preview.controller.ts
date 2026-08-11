import { Body, Controller, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { FrameFormat } from 'shared';
import { CurrentUser } from '../../common/nest/decorators/auth-context.decorators';
import type { WebUserContext } from '../../common/nest/auth-context';
import { PreviewDynamicContentDto } from './dto/preview-dynamic-content.dto';
import { DynamicContentService } from './dynamic-content.service';

@Controller()
export class DynamicPreviewController {
  constructor(private readonly dynamicContent: DynamicContentService) {}

  @Post('contents/preview')
  async previewDynamicDirect(
    @Body() body: PreviewDynamicContentDto,
    @Query('format') rawFormat: string | undefined,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const data = await this.dynamicContent.previewDirect(
      body,
      FrameFormat.catch('mono1').parse(rawFormat)
    );
    void reply.header('Cache-Control', 'no-store').type('application/octet-stream').send(data);
  }

  @Post('contents/:contentId/preview')
  async previewDynamic(
    @Param('contentId') contentId: string,
    @CurrentUser() user: WebUserContext,
    @Body() body: PreviewDynamicContentDto,
    @Query('format') rawFormat: string | undefined,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const data = await this.dynamicContent.preview(
      contentId,
      user.userId,
      {
        config: body.config,
        frame_name: body.frame_name,
        data: body.data,
      },
      FrameFormat.catch('mono1').parse(rawFormat)
    );
    void reply.header('Cache-Control', 'no-store').type('application/octet-stream').send(data);
  }
}
