ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache jq

RUN npm install -g mcp-picnic

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
