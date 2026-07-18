import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AchievementsResponse, AuthSession, BuyItemBody, BuyItemResponse, CardsResponse, CommunityStats, ErrorResponse, GetAllCardsParams, GetGuildsParams, GetLeaderboardParams, GuildDetails, GuildsResponse, HealthStatus, InventoryResponse, LeaderboardResponse, LoginBody, LotteryResponse, MyRankResponse, RegisterBody, SendOtpBody, SendOtpResponse, ShopResponse, SuccessResponse, UserCardsResponse, UserStats, VerifyOtpBody, WishlistBody } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRegisterAccountUrl: () => string;
/**
 * @summary Register a new account with phone, name and password (no OTP)
 */
export declare const registerAccount: (registerBody: RegisterBody, options?: RequestInit) => Promise<AuthSession>;
export declare const getRegisterAccountMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerAccount>>, TError, {
        data: BodyType<RegisterBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof registerAccount>>, TError, {
    data: BodyType<RegisterBody>;
}, TContext>;
export type RegisterAccountMutationResult = NonNullable<Awaited<ReturnType<typeof registerAccount>>>;
export type RegisterAccountMutationBody = BodyType<RegisterBody>;
export type RegisterAccountMutationError = ErrorType<ErrorResponse>;
/**
* @summary Register a new account with phone, name and password (no OTP)
*/
export declare const useRegisterAccount: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerAccount>>, TError, {
        data: BodyType<RegisterBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof registerAccount>>, TError, {
    data: BodyType<RegisterBody>;
}, TContext>;
export declare const getLoginUrl: () => string;
/**
 * @summary Log in with phone and password
 */
export declare const login: (loginBody: LoginBody, options?: RequestInit) => Promise<AuthSession>;
export declare const getLoginMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginBody>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<LoginBody>;
export type LoginMutationError = ErrorType<ErrorResponse>;
/**
* @summary Log in with phone and password
*/
export declare const useLogin: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginBody>;
}, TContext>;
export declare const getSendOtpUrl: () => string;
/**
 * @summary Send a password-reset OTP via WhatsApp bot DM
 */
export declare const sendOtp: (sendOtpBody: SendOtpBody, options?: RequestInit) => Promise<SendOtpResponse>;
export declare const getSendOtpMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendOtp>>, TError, {
        data: BodyType<SendOtpBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendOtp>>, TError, {
    data: BodyType<SendOtpBody>;
}, TContext>;
export type SendOtpMutationResult = NonNullable<Awaited<ReturnType<typeof sendOtp>>>;
export type SendOtpMutationBody = BodyType<SendOtpBody>;
export type SendOtpMutationError = ErrorType<ErrorResponse>;
/**
* @summary Send a password-reset OTP via WhatsApp bot DM
*/
export declare const useSendOtp: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendOtp>>, TError, {
        data: BodyType<SendOtpBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sendOtp>>, TError, {
    data: BodyType<SendOtpBody>;
}, TContext>;
export declare const getVerifyOtpUrl: () => string;
/**
 * @summary Verify a password-reset OTP code and set a new password
 */
export declare const verifyOtp: (verifyOtpBody: VerifyOtpBody, options?: RequestInit) => Promise<AuthSession>;
export declare const getVerifyOtpMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyOtp>>, TError, {
        data: BodyType<VerifyOtpBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof verifyOtp>>, TError, {
    data: BodyType<VerifyOtpBody>;
}, TContext>;
export type VerifyOtpMutationResult = NonNullable<Awaited<ReturnType<typeof verifyOtp>>>;
export type VerifyOtpMutationBody = BodyType<VerifyOtpBody>;
export type VerifyOtpMutationError = ErrorType<ErrorResponse>;
/**
* @summary Verify a password-reset OTP code and set a new password
*/
export declare const useVerifyOtp: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyOtp>>, TError, {
        data: BodyType<VerifyOtpBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof verifyOtp>>, TError, {
    data: BodyType<VerifyOtpBody>;
}, TContext>;
export declare const getGetUserStatsUrl: () => string;
/**
 * @summary Get current user full profile and stats
 */
export declare const getUserStats: (options?: RequestInit) => Promise<UserStats>;
export declare const getGetUserStatsQueryKey: () => readonly ["/api/v1/user/stats"];
export declare const getGetUserStatsQueryOptions: <TData = Awaited<ReturnType<typeof getUserStats>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUserStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getUserStats>>>;
export type GetUserStatsQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current user full profile and stats
 */
export declare function useGetUserStats<TData = Awaited<ReturnType<typeof getUserStats>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetUserInventoryUrl: () => string;
/**
 * @summary Get current user inventory
 */
export declare const getUserInventory: (options?: RequestInit) => Promise<InventoryResponse>;
export declare const getGetUserInventoryQueryKey: () => readonly ["/api/v1/user/inventory"];
export declare const getGetUserInventoryQueryOptions: <TData = Awaited<ReturnType<typeof getUserInventory>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserInventory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUserInventory>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserInventoryQueryResult = NonNullable<Awaited<ReturnType<typeof getUserInventory>>>;
export type GetUserInventoryQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current user inventory
 */
export declare function useGetUserInventory<TData = Awaited<ReturnType<typeof getUserInventory>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserInventory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetUserAchievementsUrl: () => string;
/**
 * @summary Get current user achievements and badges
 */
export declare const getUserAchievements: (options?: RequestInit) => Promise<AchievementsResponse>;
export declare const getGetUserAchievementsQueryKey: () => readonly ["/api/v1/user/achievements"];
export declare const getGetUserAchievementsQueryOptions: <TData = Awaited<ReturnType<typeof getUserAchievements>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserAchievements>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUserAchievements>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserAchievementsQueryResult = NonNullable<Awaited<ReturnType<typeof getUserAchievements>>>;
export type GetUserAchievementsQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current user achievements and badges
 */
export declare function useGetUserAchievements<TData = Awaited<ReturnType<typeof getUserAchievements>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserAchievements>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetShopItemsUrl: () => string;
/**
 * @summary Get all shop items by category
 */
export declare const getShopItems: (options?: RequestInit) => Promise<ShopResponse>;
export declare const getGetShopItemsQueryKey: () => readonly ["/api/v1/shop"];
export declare const getGetShopItemsQueryOptions: <TData = Awaited<ReturnType<typeof getShopItems>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getShopItems>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getShopItems>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetShopItemsQueryResult = NonNullable<Awaited<ReturnType<typeof getShopItems>>>;
export type GetShopItemsQueryError = ErrorType<unknown>;
/**
 * @summary Get all shop items by category
 */
export declare function useGetShopItems<TData = Awaited<ReturnType<typeof getShopItems>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getShopItems>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getBuyShopItemUrl: () => string;
/**
 * @summary Buy an item from the shop
 */
export declare const buyShopItem: (buyItemBody: BuyItemBody, options?: RequestInit) => Promise<BuyItemResponse>;
export declare const getBuyShopItemMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof buyShopItem>>, TError, {
        data: BodyType<BuyItemBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof buyShopItem>>, TError, {
    data: BodyType<BuyItemBody>;
}, TContext>;
export type BuyShopItemMutationResult = NonNullable<Awaited<ReturnType<typeof buyShopItem>>>;
export type BuyShopItemMutationBody = BodyType<BuyItemBody>;
export type BuyShopItemMutationError = ErrorType<ErrorResponse>;
/**
* @summary Buy an item from the shop
*/
export declare const useBuyShopItem: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof buyShopItem>>, TError, {
        data: BodyType<BuyItemBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof buyShopItem>>, TError, {
    data: BodyType<BuyItemBody>;
}, TContext>;
export declare const getGetAllCardsUrl: (params?: GetAllCardsParams) => string;
/**
 * @summary Get all cards with optional filtering
 */
export declare const getAllCards: (params?: GetAllCardsParams, options?: RequestInit) => Promise<CardsResponse>;
export declare const getGetAllCardsQueryKey: (params?: GetAllCardsParams) => readonly ["/api/v1/cards", ...GetAllCardsParams[]];
export declare const getGetAllCardsQueryOptions: <TData = Awaited<ReturnType<typeof getAllCards>>, TError = ErrorType<unknown>>(params?: GetAllCardsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAllCards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAllCards>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAllCardsQueryResult = NonNullable<Awaited<ReturnType<typeof getAllCards>>>;
export type GetAllCardsQueryError = ErrorType<unknown>;
/**
 * @summary Get all cards with optional filtering
 */
export declare function useGetAllCards<TData = Awaited<ReturnType<typeof getAllCards>>, TError = ErrorType<unknown>>(params?: GetAllCardsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAllCards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMyCardsUrl: () => string;
/**
 * @summary Get authenticated user's card collection
 */
export declare const getMyCards: (options?: RequestInit) => Promise<UserCardsResponse>;
export declare const getGetMyCardsQueryKey: () => readonly ["/api/v1/cards/my"];
export declare const getGetMyCardsQueryOptions: <TData = Awaited<ReturnType<typeof getMyCards>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyCards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyCards>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyCardsQueryResult = NonNullable<Awaited<ReturnType<typeof getMyCards>>>;
export type GetMyCardsQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get authenticated user's card collection
 */
export declare function useGetMyCards<TData = Awaited<ReturnType<typeof getMyCards>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyCards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getAddCardToWishlistUrl: () => string;
/**
 * @summary Notify card owner that you want to trade
 */
export declare const addCardToWishlist: (wishlistBody: WishlistBody, options?: RequestInit) => Promise<SuccessResponse>;
export declare const getAddCardToWishlistMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addCardToWishlist>>, TError, {
        data: BodyType<WishlistBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addCardToWishlist>>, TError, {
    data: BodyType<WishlistBody>;
}, TContext>;
export type AddCardToWishlistMutationResult = NonNullable<Awaited<ReturnType<typeof addCardToWishlist>>>;
export type AddCardToWishlistMutationBody = BodyType<WishlistBody>;
export type AddCardToWishlistMutationError = ErrorType<ErrorResponse>;
/**
* @summary Notify card owner that you want to trade
*/
export declare const useAddCardToWishlist: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addCardToWishlist>>, TError, {
        data: BodyType<WishlistBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addCardToWishlist>>, TError, {
    data: BodyType<WishlistBody>;
}, TContext>;
export declare const getGetLeaderboardUrl: (params?: GetLeaderboardParams) => string;
/**
 * @summary Get global XP/level leaderboard
 */
export declare const getLeaderboard: (params?: GetLeaderboardParams, options?: RequestInit) => Promise<LeaderboardResponse>;
export declare const getGetLeaderboardQueryKey: (params?: GetLeaderboardParams) => readonly ["/api/v1/leaderboard", ...GetLeaderboardParams[]];
export declare const getGetLeaderboardQueryOptions: <TData = Awaited<ReturnType<typeof getLeaderboard>>, TError = ErrorType<unknown>>(params?: GetLeaderboardParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLeaderboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getLeaderboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetLeaderboardQueryResult = NonNullable<Awaited<ReturnType<typeof getLeaderboard>>>;
export type GetLeaderboardQueryError = ErrorType<unknown>;
/**
 * @summary Get global XP/level leaderboard
 */
export declare function useGetLeaderboard<TData = Awaited<ReturnType<typeof getLeaderboard>>, TError = ErrorType<unknown>>(params?: GetLeaderboardParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLeaderboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMyRankUrl: () => string;
/**
 * @summary Get current user's rank position
 */
export declare const getMyRank: (options?: RequestInit) => Promise<MyRankResponse>;
export declare const getGetMyRankQueryKey: () => readonly ["/api/v1/leaderboard/me"];
export declare const getGetMyRankQueryOptions: <TData = Awaited<ReturnType<typeof getMyRank>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyRank>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyRank>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyRankQueryResult = NonNullable<Awaited<ReturnType<typeof getMyRank>>>;
export type GetMyRankQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current user's rank position
 */
export declare function useGetMyRank<TData = Awaited<ReturnType<typeof getMyRank>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyRank>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetGuildsUrl: (params?: GetGuildsParams) => string;
/**
 * @summary Get all guilds
 */
export declare const getGuilds: (params?: GetGuildsParams, options?: RequestInit) => Promise<GuildsResponse>;
export declare const getGetGuildsQueryKey: (params?: GetGuildsParams) => readonly ["/api/v1/guilds", ...GetGuildsParams[]];
export declare const getGetGuildsQueryOptions: <TData = Awaited<ReturnType<typeof getGuilds>>, TError = ErrorType<unknown>>(params?: GetGuildsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGuilds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getGuilds>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetGuildsQueryResult = NonNullable<Awaited<ReturnType<typeof getGuilds>>>;
export type GetGuildsQueryError = ErrorType<unknown>;
/**
 * @summary Get all guilds
 */
export declare function useGetGuilds<TData = Awaited<ReturnType<typeof getGuilds>>, TError = ErrorType<unknown>>(params?: GetGuildsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGuilds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetGuildUrl: (guildId: string) => string;
/**
 * @summary Get a specific guild by ID
 */
export declare const getGuild: (guildId: string, options?: RequestInit) => Promise<GuildDetails>;
export declare const getGetGuildQueryKey: (guildId: string) => readonly [`/api/v1/guilds/${string}`];
export declare const getGetGuildQueryOptions: <TData = Awaited<ReturnType<typeof getGuild>>, TError = ErrorType<ErrorResponse>>(guildId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGuild>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getGuild>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetGuildQueryResult = NonNullable<Awaited<ReturnType<typeof getGuild>>>;
export type GetGuildQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get a specific guild by ID
 */
export declare function useGetGuild<TData = Awaited<ReturnType<typeof getGuild>>, TError = ErrorType<ErrorResponse>>(guildId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGuild>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetLotteryStateUrl: () => string;
/**
 * @summary Get current lottery state, entries, and recent winners
 */
export declare const getLotteryState: (options?: RequestInit) => Promise<LotteryResponse>;
export declare const getGetLotteryStateQueryKey: () => readonly ["/api/v1/lottery"];
export declare const getGetLotteryStateQueryOptions: <TData = Awaited<ReturnType<typeof getLotteryState>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLotteryState>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getLotteryState>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetLotteryStateQueryResult = NonNullable<Awaited<ReturnType<typeof getLotteryState>>>;
export type GetLotteryStateQueryError = ErrorType<unknown>;
/**
 * @summary Get current lottery state, entries, and recent winners
 */
export declare function useGetLotteryState<TData = Awaited<ReturnType<typeof getLotteryState>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLotteryState>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCommunityStatsUrl: () => string;
/**
 * @summary Get community-wide stats (total members, active missions, etc.)
 */
export declare const getCommunityStats: (options?: RequestInit) => Promise<CommunityStats>;
export declare const getGetCommunityStatsQueryKey: () => readonly ["/api/v1/community/stats"];
export declare const getGetCommunityStatsQueryOptions: <TData = Awaited<ReturnType<typeof getCommunityStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCommunityStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCommunityStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCommunityStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getCommunityStats>>>;
export type GetCommunityStatsQueryError = ErrorType<unknown>;
/**
 * @summary Get community-wide stats (total members, active missions, etc.)
 */
export declare function useGetCommunityStats<TData = Awaited<ReturnType<typeof getCommunityStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCommunityStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map