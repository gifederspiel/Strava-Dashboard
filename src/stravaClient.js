const axios = require('axios');

const {
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  STRAVA_REFRESH_TOKEN,
  STRAVA_ACCESS_TOKEN,
  STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token',
  STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3',
} = process.env;

if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
  throw new Error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in your environment');
}

let accessToken = STRAVA_ACCESS_TOKEN || null;
let accessTokenExpiresAt = Number(process.env.STRAVA_ACCESS_TOKEN_EXPIRES_AT || 0);
let refreshToken = STRAVA_REFRESH_TOKEN || null;

async function refreshAccessToken() {
  if (!refreshToken) {
    throw new Error(
      'STRAVA_REFRESH_TOKEN missing. Generate tokens via the Strava OAuth flow before running the server.'
    );
  }

  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
  });

  const response = await axios.post(STRAVA_TOKEN_URL, payload, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const {
    access_token: newToken,
    expires_in: expiresIn = 3600,
    refresh_token: newRefreshToken,
  } = response.data;

  if (!newToken) {
    throw new Error('Strava token refresh response did not include an access_token');
  }

  accessToken = newToken;
  accessTokenExpiresAt = Date.now() + expiresIn * 1000 - 60 * 1000;
  refreshToken = newRefreshToken || refreshToken;

  // Strava can rotate refresh tokens. Surface that to the caller so it can be stored.
  return {
    accessToken,
    refreshToken,
    expiresAt: accessTokenExpiresAt,
  };
}

async function getAccessToken() {
  if (!accessToken) {
    if (!refreshToken) {
      throw new Error(
        'No Strava access token available. Provide STRAVA_ACCESS_TOKEN or STRAVA_REFRESH_TOKEN in your environment.'
      );
    }
    const { accessToken: newToken } = await refreshAccessToken();
    return newToken;
  }

  if (Date.now() >= accessTokenExpiresAt) {
    const { accessToken: newToken } = await refreshAccessToken();
    return newToken;
  }

  return accessToken;
}

async function stravaRequest(method, path, { params, data, headers } = {}) {
  const token = await getAccessToken();

  const url = `${STRAVA_API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;

  try {
    const response = await axios({
      method,
      url,
      params,
      data,
      headers: {
        ...(headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      const { accessToken: newToken } = await refreshAccessToken();

      const retryResponse = await axios({
        method,
        url,
        params,
        data,
        headers: {
          ...(headers || {}),
          Authorization: `Bearer ${newToken}`,
        },
      });

      return retryResponse.data;
    }

    throw error;
  }
}

async function fetchAthlete() {
  return stravaRequest('get', '/athlete');
}

async function fetchActivities({ before, after, page, perPage } = {}) {
  return stravaRequest('get', '/athlete/activities', {
    params: {
      before,
      after,
      page,
      per_page: perPage,
    },
  });
}

async function fetchActivityById(id, { includeAllEfforts } = {}) {
  if (!id) {
    throw new Error('Activity id must be provided');
  }

  return stravaRequest('get', `/activities/${id}`, {
    params: {
      include_all_efforts: includeAllEfforts,
    },
  });
}

async function fetchActivityStreams(id, keys = ['time', 'latlng', 'heartrate']) {
  if (!id) {
    throw new Error('Activity id must be provided to fetch streams');
  }

  const params = {
    keys: keys.join(','),
    key_by_type: true,
  };

  try {
    return await stravaRequest('get', `/activities/${id}/streams`, { params });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // Some activities may not have the requested stream types (e.g., no heart rate sensor).
      return {};
    }
    throw error;
  }
}

module.exports = {
  refreshAccessToken,
  getAccessToken,
  getAccessTokenExpiry: () => accessTokenExpiresAt,
  stravaRequest,
  fetchAthlete,
  fetchActivities,
  fetchActivityById,
  fetchActivityStreams,
};
