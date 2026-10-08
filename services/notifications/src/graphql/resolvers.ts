import {
  Args,
  Context,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
  ResolveReference,
} from '@nestjs/graphql';
import { CurrentUser, type AuthUser, type GraphQLContext } from '@shopstream/platform';
import { NotificationsService, toNotificationView, toTimelineView } from '../notifications.service';

@Resolver('Order')
export class OrderTimelineResolver {
  constructor(private readonly notifications: NotificationsService) {}

  @ResolveReference()
  resolveReference(ref: { id: string }) {
    return { id: ref.id };
  }

  @ResolveField('timeline')
  async timeline(@Parent() order: { id: string }, @Context() ctx: GraphQLContext) {
    if (!ctx.user) return [];
    const rows = await this.notifications.timelineFor(order.id, ctx.user.id);
    return rows.map(toTimelineView);
  }
}

@Resolver()
export class NotificationFeedResolver {
  constructor(private readonly notifications: NotificationsService) {}

  @Query('notifications')
  async feed(@CurrentUser() user: AuthUser, @Args('first') first: number) {
    return (await this.notifications.feed(user.id, first ?? 20)).map(toNotificationView);
  }

  @Query('unreadNotificationCount')
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Mutation('markNotificationsRead')
  markRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }
}
